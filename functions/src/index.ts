import * as admin from 'firebase-admin'
import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https'
import axios from 'axios'
import * as crypto from 'crypto'

admin.initializeApp()
const db = admin.firestore()

const PAYSTACK_KEY = process.env.PAYSTACK_SECRET_KEY || ''
const PAYSTACK_API = 'https://api.paystack.co'

// ─── Paystack helpers ─────────────────────────────────────────────────────────
const paystackHeaders = {
  Authorization: `Bearer ${PAYSTACK_KEY}`,
  'Content-Type': 'application/json',
}

async function paystackGet(path: string) {
  const res = await axios.get(`${PAYSTACK_API}${path}`, { headers: paystackHeaders })
  return res.data
}

async function paystackPost(path: string, body: object) {
  const res = await axios.post(`${PAYSTACK_API}${path}`, body, { headers: paystackHeaders })
  return res.data
}

async function paystackPut(path: string, body: object) {
  const res = await axios.put(`${PAYSTACK_API}${path}`, body, { headers: paystackHeaders })
  return res.data
}

// ─── Bank list (fetched live from Paystack, cached 24 h) ──────────────────────
type PaystackBank = { name: string; slug: string; code: string; currency: string }
let bankCache: { fetched: number; banks: PaystackBank[] } | null = null
const BANK_CACHE_TTL_MS = 24 * 60 * 60 * 1000

async function getSaBanks(): Promise<PaystackBank[]> {
  if (bankCache && Date.now() - bankCache.fetched < BANK_CACHE_TTL_MS) {
    return bankCache.banks
  }
  const result = await paystackGet('/bank?country=south africa&currency=ZAR')
  if (!result.status) throw new Error('Failed to fetch bank list from Paystack')
  bankCache = { fetched: Date.now(), banks: result.data as PaystackBank[] }
  return bankCache.banks
}

/** Find bank code by fuzzy-matching the user-provided bank name. */
async function findBankCode(bankName: string): Promise<string | null> {
  if (!bankName) return null
  const banks = await getSaBanks()
  const needle = bankName.trim().toLowerCase()
  // Exact match first
  const exact = banks.find(b => b.name.toLowerCase() === needle)
  if (exact) return exact.code
  // Slug match
  const bySlug = banks.find(b => b.slug.toLowerCase() === needle.replace(/\s+/g, '-'))
  if (bySlug) return bySlug.code
  // Substring — "Absa" matches "Absa Bank", "FNB" matches "First National Bank"
  const partial = banks.find(b =>
    b.name.toLowerCase().includes(needle) || needle.includes(b.name.toLowerCase().split(' ')[0])
  )
  return partial?.code ?? null
}

/** Verify an account number against a bank. Returns { name } on success or throws. */
async function resolveAccount(accountNumber: string, bankCode: string): Promise<{ accountName: string }> {
  const result = await paystackGet(
    `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${bankCode}`,
  )
  if (!result.status) throw new Error(result.message || 'Account resolution failed')
  return { accountName: (result.data.account_name as string).trim() }
}

/** Loose name comparison — Paystack returns uppercase; providers use different orderings. */
function namesRoughlyMatch(provided: string, resolved: string): boolean {
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z ]/g, '').split(/\s+/).filter(w => w.length >= 3)
  const p = new Set(norm(provided))
  const r = norm(resolved)
  // At least one word ≥3 chars overlaps
  return r.some(w => p.has(w))
}

// ─── FCM helpers ──────────────────────────────────────────────────────────────

/** Send to a consumer — reads fcmToken from users/{userId} */
async function sendFCM(userId: string, title: string, body: string, data?: Record<string, string>) {
  try {
    const snap = await db.collection('users').doc(userId).get()
    const token = snap.data()?.fcmToken as string | undefined
    if (!token) return
    await admin.messaging().send({ token, notification: { title, body }, data })
  } catch (e) {
    console.error('FCM (consumer) error:', e)
  }
}

/** Send to a vendor — reads fcmToken from vendors/{vendorId} */
async function sendFCMToVendor(vendorId: string, title: string, body: string, data?: Record<string, string>) {
  try {
    const snap = await db.collection('vendors').doc(vendorId).get()
    const token = snap.data()?.fcmToken as string | undefined
    if (!token) return
    await admin.messaging().send({ token, notification: { title, body }, data })
  } catch (e) {
    console.error('FCM (vendor) error:', e)
  }
}

/** Send to a driver — reads fcmToken from drivers/{driverId} */
async function sendFCMToDriver(driverId: string, title: string, body: string, data?: Record<string, string>) {
  try {
    const snap = await db.collection('drivers').doc(driverId).get()
    const token = snap.data()?.fcmToken as string | undefined
    if (!token) return
    const isIncoming = data?.type === 'new_delivery'
    await admin.messaging().send({
      token,
      notification: { title, body },
      data,
      android: {
        // Route delivery alerts through the call-style channel so FLAG_INSISTENT
        // and the alarm audio stream apply even when the app is in the background.
        notification: {
          channelId: isIncoming ? 'tolta_driver_incoming' : 'tolta_driver_deliveries',
          priority: 'max',
          ...(isIncoming && { visibility: 'public' }),
        },
      },
    })
  } catch (e) {
    console.error('FCM (driver) error:', e)
  }
}

// ─── 1a. Subaccount creation core (used by trigger + admin retry) ─────────────
// Returns { ok: true } if the subaccount was created (or already existed),
// otherwise { ok: false, error, stage } with a human-readable reason.
type SubaccountResult =
  | { ok: true; subaccountCode: string; resolvedAccountName: string }
  | { ok: false; error: string; stage: 'bank_lookup' | 'account_resolve' | 'name_mismatch' | 'paystack_create' }

async function createSubaccountForVendor(
  vendorRef: FirebaseFirestore.DocumentReference,
  vendor: FirebaseFirestore.DocumentData,
): Promise<SubaccountResult> {
  const bankName      = vendor.bankDetails?.bankName as string | undefined
  const accountNumber = vendor.bankDetails?.accountNumber as string | undefined
  const accountName   = vendor.bankDetails?.accountName as string | undefined

  if (!bankName || !accountNumber || !accountName) {
    return { ok: false, error: 'Bank details incomplete on vendor profile.', stage: 'bank_lookup' }
  }

  // 1. Look up bank code from live Paystack bank list
  let bankCode: string | null
  try {
    bankCode = await findBankCode(bankName)
  } catch (e) {
    return { ok: false, error: `Could not fetch bank list: ${(e as Error).message}`, stage: 'bank_lookup' }
  }
  if (!bankCode) {
    return { ok: false, error: `"${bankName}" is not supported by Paystack in South Africa.`, stage: 'bank_lookup' }
  }

  // 2. Resolve account number to verify it exists at that bank
  let resolved: { accountName: string }
  try {
    resolved = await resolveAccount(accountNumber, bankCode)
  } catch (e) {
    const raw = (e as { response?: { data?: { message?: string } }; message?: string })
    const msg = raw.response?.data?.message ?? raw.message ?? 'Account resolution failed'
    return { ok: false, error: `Bank account could not be verified: ${msg}`, stage: 'account_resolve' }
  }

  // 3. Sanity-check the resolved name against what the vendor entered
  if (!namesRoughlyMatch(accountName, resolved.accountName)) {
    return {
      ok: false,
      error: `Account name mismatch. Entered "${accountName}" — bank returned "${resolved.accountName}".`,
      stage: 'name_mismatch',
    }
  }

  // 4. Create the Paystack subaccount
  try {
    const vendorShare = Math.round((1 - (vendor.commissionRate ?? 0.10)) * 100)
    const result = await paystackPost('/subaccount', {
      business_name:       vendor.storeName,
      settlement_bank:     bankCode,
      account_number:      accountNumber,
      percentage_charge:   vendorShare,
      settlement_schedule: 'auto',
      description:         `${vendor.storeName} — Tolta vendor`,
    })
    if (!result.status || !result.data?.subaccount_code) {
      return { ok: false, error: result.message || 'Paystack refused subaccount creation.', stage: 'paystack_create' }
    }

    await vendorRef.update({
      paystackSubaccountCode: result.data.subaccount_code,
      paystackSubaccountId:   result.data.id,
      paystackResolvedName:   resolved.accountName,
      paystackStatus:         'active',
      paystackError:          admin.firestore.FieldValue.delete(),
      paystackErrorStage:     admin.firestore.FieldValue.delete(),
      paystackUpdatedAt:      admin.firestore.FieldValue.serverTimestamp(),
    })

    return { ok: true, subaccountCode: result.data.subaccount_code, resolvedAccountName: resolved.accountName }
  } catch (e) {
    const raw = (e as { response?: { data?: { message?: string } }; message?: string })
    const msg = raw.response?.data?.message ?? raw.message ?? 'Unknown error'
    return { ok: false, error: `Paystack API error: ${msg}`, stage: 'paystack_create' }
  }
}

// ─── 1b. createVendorSubaccount (Firestore trigger) ───────────────────────────
// Fires when admin flips status: pending → active. Delegates to the shared core
// so we can reuse the same logic for admin-initiated retries.
export const createVendorSubaccount = onDocumentUpdated(
  'vendors/{vendorId}',
  async (event) => {
    const before = event.data?.before.data()
    const after  = event.data?.after.data()
    if (!before || !after) return

    // Only fire when status just changed to 'active'
    if (before.status === after.status) return
    if (after.status !== 'active') return
    if (after.paystackSubaccountCode) return // already wired up

    const result = await createSubaccountForVendor(event.data!.after.ref, after)

    if (result.ok) {
      console.log(`Subaccount created for ${after.storeName}: ${result.subaccountCode}`)
      await sendFCMToVendor(
        event.params.vendorId,
        '🎉 You\'re approved!',
        'Your Tolta vendor account is live. Start adding products!',
        { type: 'vendor_approved' },
      )
      return
    }

    // Roll status back so this vendor appears in the admin "needs attention" queue
    console.error(`Subaccount creation failed for ${event.params.vendorId} [${result.stage}]: ${result.error}`)
    await event.data!.after.ref.update({
      status:             'pending_review',
      paystackStatus:     'error',
      paystackError:      result.error,
      paystackErrorStage: result.stage,
      paystackUpdatedAt:  admin.firestore.FieldValue.serverTimestamp(),
    })
  }
)

// ─── 1c. retryVendorSubaccount (callable, admin-only) ─────────────────────────
// Lets the admin dashboard re-attempt subaccount creation after fixing bank
// details on the vendor. Enforces the caller is an authenticated admin.
export const retryVendorSubaccount = onCall<{ vendorId: string }>(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in as admin.')
    }
    const { vendorId } = request.data
    if (!vendorId) throw new HttpsError('invalid-argument', 'vendorId required.')

    const vendorRef = db.collection('vendors').doc(vendorId)
    const snap = await vendorRef.get()
    if (!snap.exists) throw new HttpsError('not-found', 'Vendor not found.')

    const vendor = snap.data()!
    if (vendor.paystackSubaccountCode) {
      return { ok: true, alreadyLinked: true, subaccountCode: vendor.paystackSubaccountCode }
    }

    // Ensure the vendor is at least approved (or was, before rollback)
    if (!['active', 'pending_review'].includes(vendor.status)) {
      throw new HttpsError('failed-precondition', `Cannot retry — vendor status is "${vendor.status}".`)
    }

    const result = await createSubaccountForVendor(vendorRef, vendor)
    if (!result.ok) {
      await vendorRef.update({
        paystackStatus:     'error',
        paystackError:      result.error,
        paystackErrorStage: result.stage,
        paystackUpdatedAt:  admin.firestore.FieldValue.serverTimestamp(),
      })
      throw new HttpsError('failed-precondition', result.error)
    }

    // If we're recovering from a rollback, bring status back to 'active'
    if (vendor.status !== 'active') {
      await vendorRef.update({ status: 'active' })
    }

    await sendFCMToVendor(
      vendorId,
      '🎉 You\'re approved!',
      'Your Tolta vendor account is live. Start adding products!',
      { type: 'vendor_approved' },
    )

    return { ok: true, subaccountCode: result.subaccountCode, resolvedName: result.resolvedAccountName }
  },
)

// ─── 1d. listSaBanks (callable, no auth) ──────────────────────────────────────
// Used by the Flutter vendor onboarding form to populate the bank dropdown from
// Paystack's live list, so it always matches what the CF will accept.
export const listSaBanks = onCall<Record<string, never>>(
  { region: 'us-central1' },
  async () => {
    const banks = await getSaBanks()
    return {
      banks: banks
        .filter(b => b.currency === 'ZAR')
        .map(b => ({ name: b.name, code: b.code, slug: b.slug }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  },
)

// ─── 2. initializePayment ─────────────────────────────────────────────────────
// Called from Flutter checkout — server-side Paystack init (keeps secret key safe)
export const initializePayment = onRequest(async (req, res) => {
  // Allow CORS for Flutter
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.status(204).send(''); return }
  if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return }

  // Extract userId from Firebase Auth token if present
  let userId = 'guest'
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.split('Bearer ')[1]
      const decoded = await admin.auth().verifyIdToken(token)
      userId = decoded.uid
    } catch (_) { /* use guest */ }
  }

  const { vendorId, amountRands, email, items, deliveryAddress, deliveryFee,
          deliveryLat, deliveryLng, deliveryDistanceKm } = req.body as {
    vendorId: string
    amountRands: number
    email: string
    items: Array<{ name: string; quantity: number; price: number }>
    deliveryAddress: string
    deliveryFee: number
    deliveryLat?: number
    deliveryLng?: number
    deliveryDistanceKm?: number
  }

  // Get vendor
  const vendorSnap = await db.collection('vendors').doc(vendorId).get()
  const vendor = vendorSnap.data()
  if (!vendor) throw new HttpsError('not-found', 'Vendor not found.')
  if (!vendor.paystackSubaccountCode) {
    throw new HttpsError('failed-precondition', 'Vendor payment account not set up yet.')
  }

  const reference     = `TB-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`
  const amountKobo    = Math.round(amountRands * 100)
  const commissionRate = vendor.commissionRate ?? 0.10
  const platformFeeKobo = Math.round(amountKobo * commissionRate) // what Tolta keeps

  // Create order in Firestore first
  const subtotal = amountRands - deliveryFee
  const orderRef = await db.collection('orders').add({
    userId:          userId,
    vendorId,
    items,
    subtotal,
    deliveryFee,
    total:           amountRands,
    deliveryAddress,
    ...(deliveryLat          != null && { deliveryLat }),
    ...(deliveryLng          != null && { deliveryLng }),
    ...(deliveryDistanceKm   != null && { deliveryDistanceKm }),
    status:          'pending_payment',
    paymentRef:      reference,
    paymentStatus:   'pending',
    createdAt:       admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:       admin.firestore.FieldValue.serverTimestamp(),
  })

  // Initialize Paystack transaction with split
  const result = await paystackPost('/transaction/initialize', {
    email,
    amount:               amountKobo,
    reference,
    subaccount:           vendor.paystackSubaccountCode,
    transaction_charge:   platformFeeKobo, // Tolta's commission
    bearer:               'account',       // Tolta bears Paystack fees
    callback_url:         'https://tolta.app/payment/done',
    metadata: {
      orderId:  orderRef.id,
      vendorId,
      userId:   userId,
      custom_fields: [
        { display_name: 'Order ID',  variable_name: 'order_id',  value: orderRef.id },
        { display_name: 'Vendor',    variable_name: 'vendor',    value: vendor.storeName },
      ],
    },
  })

  if (!result.status) {
    await orderRef.delete()
    res.status(500).json({ error: `Paystack error: ${result.message}` })
    return
  }

  res.json({
    authorizationUrl: result.data.authorization_url,
    accessCode:       result.data.access_code,
    reference,
    orderId:          orderRef.id,
  })
})

// ─── 3. paystackWebhook ───────────────────────────────────────────────────────
// Paystack POSTs here on every payment event — verify signature, update order, send FCM
export const paystackWebhook = onRequest(async (req, res) => {
  // Verify Paystack HMAC-SHA512 signature
  const signature = req.headers['x-paystack-signature'] as string
  const rawBody   = (req as unknown as { rawBody: Buffer }).rawBody

  const expectedHash = crypto
    .createHmac('sha512', PAYSTACK_KEY)
    .update(rawBody)
    .digest('hex')

  if (expectedHash !== signature) {
    console.warn('Invalid Paystack signature — request rejected')
    res.status(401).send('Unauthorized')
    return
  }

  const { event, data } = req.body as {
    event: string
    data: {
      reference: string
      amount: number
      currency: string
      channel: string
      metadata?: {
        orderId?: string
        vendorId?: string
        userId?: string
      }
    }
  }

  console.log(`Paystack event: ${event}`, { reference: data.reference })

  if (event === 'charge.success') {
    const { reference, amount, channel, metadata } = data
    const { orderId, userId, vendorId } = metadata || {}

    if (!orderId) {
      res.status(200).send('OK — no orderId in metadata')
      return
    }

    // Update order to confirmed
    await db.collection('orders').doc(orderId).update({
      status:        'placed',
      paymentStatus: 'paid',
      paidAt:        admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
      paystackData: {
        reference,
        amount,
        currency: data.currency,
        channel,
      },
    })

    // Notify vendor — new order
    if (vendorId) {
      await sendFCMToVendor(
        vendorId,
        '🛎️ New Order!',
        `Payment confirmed. Order ${reference} is waiting for you.`,
        { orderId, type: 'new_order' }
      )
    }

    // Notify consumer — confirmed
    if (userId) {
      await sendFCM(
        userId,
        '✅ Payment confirmed!',
        'Your order is confirmed and being prepared.',
        { orderId, type: 'order_confirmed' }
      )
    }
  }

  if (event === 'refund.processed') {
    const { metadata } = data
    if (metadata?.orderId) {
      await db.collection('orders').doc(metadata.orderId).update({
        status:        'cancelled',
        paymentStatus: 'refunded',
        updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
      })
    }
  }

  res.status(200).send('OK')
})

// ─── 4. updateCommission ─────────────────────────────────────────────────────
// Called from admin panel — updates Firestore + Paystack subaccount simultaneously
export const updateCommission = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated.')

  const { vendorId, commissionRate } = request.data as {
    vendorId: string
    commissionRate: number // e.g. 0.10 = 10%
  }

  if (commissionRate < 0 || commissionRate > 1) {
    throw new HttpsError('invalid-argument', 'Commission rate must be between 0 and 1.')
  }

  const vendorSnap = await db.collection('vendors').doc(vendorId).get()
  const vendor = vendorSnap.data()
  if (!vendor) throw new HttpsError('not-found', 'Vendor not found.')

  // Update Firestore
  await db.collection('vendors').doc(vendorId).update({
    commissionRate,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  // Update Paystack subaccount if exists
  if (vendor.paystackSubaccountCode) {
    const vendorShare = Math.round((1 - commissionRate) * 100)
    await paystackPut(`/subaccount/${vendor.paystackSubaccountCode}`, {
      percentage_charge: vendorShare,
    })
  }

  return { success: true, commissionRate, vendorId }
})

// ─── 5. notifyOrderStatus ─────────────────────────────────────────────────────
// Fires on every order status change — pushes FCM to consumer
export const notifyOrderStatus = onDocumentUpdated(
  'orders/{orderId}',
  async (event) => {
    const before = event.data?.before.data()
    const after  = event.data?.after.data()
    if (!before || !after) return
    if (before.status === after.status) return

    const MESSAGES: Record<string, { title: string; body: string }> = {
      placed:     { title: '✅ Order received!',    body: 'Your order is waiting for the vendor.' },
      confirmed:  { title: '👍 Order accepted!',    body: 'The vendor is packing your order now.' },
      ready:      { title: '📦 Ready for pickup',   body: 'Your order is packed. Driver on the way.' },
      on_the_way: { title: '🚗 On the way!',        body: 'Your driver is heading to you.' },
      delivered:  { title: '🎉 Delivered!',         body: 'Your order has arrived. Enjoy!' },
      cancelled:  { title: '❌ Order cancelled',    body: 'Your order has been cancelled.' },
    }

    const msg = MESSAGES[after.status]
    if (!msg || !after.userId) return

    await sendFCM(
      after.userId as string,
      msg.title,
      msg.body,
      { orderId: event.params.orderId, status: after.status, type: 'order_update' }
    )
  }
)

// ─── Shared: find nearest available driver and assign ─────────────────────────
async function findAndAssignDriver(
  orderId: string,
  orderRef: FirebaseFirestore.DocumentReference,
  vendorId: string,
  excludeDriverIds: string[] = [],
): Promise<boolean> {
  // All online drivers
  const trackingSnap = await db.collection('tracking_sessions')
    .where('isActive', '==', true)
    .get()

  if (trackingSnap.empty) {
    console.log(`No online drivers for order ${orderId}`)
    return false
  }

  const allOnline = trackingSnap.docs
    .map(d => ({ id: d.id, lat: d.data().lat as number, lng: d.data().lng as number }))
    .filter(d => !excludeDriverIds.includes(d.id))

  if (allOnline.length === 0) {
    console.log(`No eligible drivers for order ${orderId} (all excluded or offline)`)
    return false
  }

  const onlineIds = allOnline.map(d => d.id)

  // Firestore 'in' max 10 — batch the busy-check
  const busyIds = new Set<string>()
  for (let i = 0; i < onlineIds.length; i += 10) {
    const chunk = onlineIds.slice(i, i + 10)
    const busySnap = await db.collection('orders')
      .where('driverId', 'in', chunk)
      .where('status', 'in', ['ready', 'on_the_way'])
      .get()
    busySnap.docs.forEach(d => busyIds.add(d.data().driverId as string))
  }

  const available = allOnline.filter(d => !busyIds.has(d.id))
  if (available.length === 0) {
    console.log(`All drivers busy for order ${orderId}`)
    return false
  }

  // Pick closest driver to vendor
  const vendorSnap = await db.collection('vendors').doc(vendorId).get()
  const vendorData = vendorSnap.data() ?? {}
  const vendorName = (vendorData.storeName as string) ?? 'Vendor'
  const vLoc = vendorData.location as { latitude: number; longitude: number } | undefined

  let driverId = available[0].id
  if (vLoc) {
    let minDist = Infinity
    for (const d of available) {
      if (d.lat == null || d.lng == null) continue
      const dist = Math.sqrt(
        Math.pow(d.lat - vLoc.latitude, 2) + Math.pow(d.lng - vLoc.longitude, 2)
      )
      if (dist < minDist) { minDist = dist; driverId = d.id }
    }
  }

  await orderRef.update({
    driverId,
    deliveryStatus: 'assigned',
    assignedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
  })

  await sendFCMToDriver(
    driverId,
    '🛵 New Delivery!',
    `Pickup from ${vendorName}`,
    { orderId, type: 'new_delivery', vendorName, vendorId }
  )

  console.log(`Order ${orderId} assigned to driver ${driverId}`)
  return true
}

// ─── 6. assignOrderToDriver ──────────────────────────────────────────────────
// Fires when order status changes to 'ready' — finds nearest available driver
export const assignOrderToDriver = onDocumentUpdated('orders/{orderId}', async (event) => {
  const before = event.data?.before.data()
  const after  = event.data?.after.data()
  if (!before || !after) return
  if (before.status === after.status) return
  if (after.status !== 'ready') return
  if (after.driverId) return // already assigned

  await findAndAssignDriver(
    event.params.orderId,
    event.data!.after.ref,
    after.vendorId as string,
  )
})

// ─── 6b. reassignOnDecline ────────────────────────────────────────────────────
// Fires when a driver declines — driverId removed from a 'ready' order.
// Re-runs assignment excluding the driver who just declined.
export const reassignOnDecline = onDocumentUpdated('orders/{orderId}', async (event) => {
  const before = event.data?.before.data()
  const after  = event.data?.after.data()
  if (!before || !after) return

  // Only care about ready orders where driverId was just removed
  if (after.status !== 'ready') return
  if (!before.driverId || after.driverId) return // must have had a driver and now it's gone

  const declinedDriver = before.driverId as string
  const orderId = event.params.orderId
  console.log(`Driver ${declinedDriver} declined order ${orderId} — reassigning`)

  // Track declined drivers on the order to avoid re-assigning the same one
  const alreadyDeclined = (after.declinedBy as string[] | undefined) ?? []
  const excludeIds = [...alreadyDeclined, declinedDriver]

  await event.data!.after.ref.update({
    declinedBy: excludeIds,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  await findAndAssignDriver(
    orderId,
    event.data!.after.ref,
    after.vendorId as string,
    excludeIds,
  )
})

// ─── 7. recordDeliveryEarnings ────────────────────────────────────────────────
// Fires when order status → 'delivered' — writes earnings to driver_earnings
export const recordDeliveryEarnings = onDocumentUpdated('orders/{orderId}', async (event) => {
  const before = event.data?.before.data()
  const after  = event.data?.after.data()
  if (!before || !after) return
  if (before.status === after.status) return
  if (after.status !== 'delivered') return
  if (!after.driverId) return

  const orderId  = event.params.orderId
  const driverId = after.driverId as string

  // Fetch delivery pricing from admin settings
  const settingsSnap = await db.collection('settings').doc('deliveryPricing').get()
  const settings = settingsSnap.data() ?? {}
  const baseFee: number = (settings.baseFee as number) ?? 30

  // Write earnings record
  await db.collection('driver_earnings').add({
    driverId,
    orderId,
    amount:    baseFee,
    type:      'delivery',
    status:    'pending_payout',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  // Update wallet balance — this is what the wallet screen reads
  await db.collection('drivers').doc(driverId)
    .collection('wallet').doc('main')
    .set({
      balance:        admin.firestore.FieldValue.increment(baseFee),
      totalEarned:    admin.firestore.FieldValue.increment(baseFee),
      pendingPayout:  admin.firestore.FieldValue.increment(baseFee),
      updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })

  // Notify driver
  await sendFCMToDriver(
    driverId,
    '💰 Delivery Complete!',
    `R${baseFee} added to your wallet.`,
    { orderId, type: 'earnings_added', amount: String(baseFee) }
  )

  console.log(`Earnings R${baseFee} recorded for driver ${driverId} on order ${orderId}`)
})

// ─── 8. verifyPayment ────────────────────────────────────────────────────────
// Called directly from the Flutter checkout after the Paystack WebView
// detects the success redirect.  Verifies the charge with Paystack's REST API
// and marks the order 'placed' immediately — so the vendor sees the order
// even if the webhook hasn't fired yet (misconfigured webhook URL, test mode, etc.)
export const verifyPayment = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated.')

  const { orderId, reference } = request.data as { orderId: string; reference: string }
  if (!orderId || !reference) {
    throw new HttpsError('invalid-argument', 'orderId and reference are required.')
  }

  // Ask Paystack to confirm the charge
  let txn: Record<string, unknown>
  try {
    const res = await axios.get(`${PAYSTACK_API}/transaction/verify/${reference}`, {
      headers: paystackHeaders,
    })
    txn = res.data?.data as Record<string, unknown>
  } catch (e) {
    console.error('Paystack verify error:', e)
    throw new HttpsError('internal', 'Could not reach Paystack.')
  }

  if (!txn || txn['status'] !== 'success') {
    console.warn(`Payment not confirmed for reference ${reference}:`, txn?.['status'])
    throw new HttpsError('failed-precondition', 'Payment not confirmed by Paystack.')
  }

  // Fetch the order
  const orderSnap = await db.collection('orders').doc(orderId).get()
  const order = orderSnap.data()
  if (!order) throw new HttpsError('not-found', 'Order not found.')

  // Idempotent — if the webhook already updated it, do nothing
  if (order['status'] !== 'pending_payment') {
    return { status: order['status'] }
  }

  // Update order → placed
  await db.collection('orders').doc(orderId).update({
    status:        'placed',
    paymentStatus: 'paid',
    paidAt:        admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
    paystackData: {
      reference: txn['reference'],
      amount:    txn['amount'],
      currency:  txn['currency'],
      channel:   txn['channel'],
    },
  })

  console.log(`Order ${orderId} confirmed via verifyPayment (ref: ${reference})`)

  // Notify vendor — new order ready to accept
  if (order['vendorId']) {
    await sendFCMToVendor(
      order['vendorId'] as string,
      '🛎️ New Order!',
      `Payment confirmed. Order ${String(reference).substring(0, 12)} is waiting.`,
      { orderId, type: 'new_order' }
    )
  }

  // Notify consumer — confirmed
  if (order['userId']) {
    await sendFCM(
      order['userId'] as string,
      '✅ Payment confirmed!',
      'Your order is confirmed and being prepared.',
      { orderId, type: 'order_confirmed' }
    )
  }

  return { status: 'placed' }
})

// ─── 8b. notifyDeliveryStatus ────────────────────────────────────────────────
// Fires when deliveryStatus changes on an order — notifies vendor
export const notifyDeliveryStatus = onDocumentUpdated('orders/{orderId}', async (event) => {
  const before = event.data?.before.data()
  const after  = event.data?.after.data()
  if (!before || !after) return
  if (before.deliveryStatus === after.deliveryStatus) return

  const orderId = event.params.orderId
  const vendorId = after.vendorId as string | undefined
  if (!vendorId) return

  if (after.deliveryStatus === 'accepted') {
    // Driver accepted and is heading to vendor for pickup
    await sendFCMToVendor(
      vendorId,
      '🛵 Driver on the way!',
      'Driver accepted the order and is heading to your store.',
      { orderId, type: 'driver_accepted' }
    )
  }
})

// ─── Phone Authentication - Custom Token ────────────────────────────────────
// Industry standard: After Twilio verifies phone, create custom Firebase token
// Same phone number = same UID every time

interface CreateCustomTokenRequest {
  phone: string
}

interface CreateCustomTokenResponse {
  token: string
  uid: string
  isNewUser: boolean
}

export const createPhoneAuthToken = onCall<CreateCustomTokenRequest>(
  { region: 'africa-south1' },
  async (request): Promise<CreateCustomTokenResponse> => {
    const { phone } = request.data
    
    if (!phone || !phone.startsWith('+27') || phone.length !== 12) {
      throw new HttpsError('invalid-argument', 'Valid South African phone number required (+27...)')
    }

    // Create consistent UID from phone (hash the phone number)
    const uid = crypto.createHash('sha256').update(phone).digest('hex').substring(0, 28)
    
    try {
      // Check if user already exists
      let isNewUser = false
      
      try {
        await admin.auth().getUser(uid)
        console.log('Existing user found:', uid)
      } catch (e) {
        // User doesn't exist, create new one
        await admin.auth().createUser({
          uid,
          phoneNumber: phone,
        })
        isNewUser = true
        console.log('New user created:', uid)
      }

      // Create custom token for this user
      const token = await admin.auth().createCustomToken(uid)
      
      return { token, uid, isNewUser }
    } catch (e) {
      console.error('Error creating custom token:', e)
      throw new HttpsError('internal', 'Failed to create authentication token')
    }
  }
)
