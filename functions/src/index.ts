import * as admin from 'firebase-admin'
import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https'
import axios from 'axios'
import * as crypto from 'crypto'

admin.initializeApp()
const db = admin.firestore()

const PAYSTACK_KEY = process.env.PAYSTACK_SECRET_KEY || ''
const PAYSTACK_API = 'https://api.paystack.co'

// ─── Business settings (single source of truth, admin-controlled) ─────────────
// Every CF that touches money reads from here. Cached in-memory for 60 seconds
// so admin changes take effect within one minute for new orders.
export type BusinessSettings = {
  markupRate:            number  // e.g. 0.17 = 17% platform markup on merchant price
  driverCommissionRate:  number  // e.g. 0.10 = Tolta keeps 10% of delivery fee
  deliveryFeeBase:       number  // R base delivery fee
  deliveryFeePerKm:      number  // R per km
  deliveryRadiusKmMax:   number  // max km customer ↔ vendor
  driverSearchRadiusKm:  number  // max km to look for a driver
  minOrderDefault:       number  // fallback min order
  absorbPaystackFee:     boolean // true = Tolta absorbs (Option A)
}

const DEFAULT_SETTINGS: BusinessSettings = {
  markupRate:            0.17,
  driverCommissionRate:  0.10,
  deliveryFeeBase:       15,
  deliveryFeePerKm:      3,
  deliveryRadiusKmMax:   15,
  driverSearchRadiusKm:  20,
  minOrderDefault:       50,
  absorbPaystackFee:     true,
}

let settingsCache: { fetched: number; value: BusinessSettings } | null = null
const SETTINGS_CACHE_TTL_MS = 60 * 1000

async function getBusinessSettings(): Promise<BusinessSettings> {
  if (settingsCache && Date.now() - settingsCache.fetched < SETTINGS_CACHE_TTL_MS) {
    return settingsCache.value
  }
  const snap = await db.collection('settings').doc('business').get()
  const value: BusinessSettings = snap.exists
    ? { ...DEFAULT_SETTINGS, ...(snap.data() as Partial<BusinessSettings>) }
    : DEFAULT_SETTINGS
  settingsCache = { fetched: Date.now(), value }
  return value
}

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

// Note: Paystack's /bank/resolve endpoint does not support South Africa yet —
// it only accepts NGN, USD, GHS, KES. Confirmed by probing the live API on
// 2026-06-29. So no account-name verification is possible via Paystack for SA.
// Vendors' bank details are trusted at onboarding and validated out-of-band
// (proof-of-account upload + admin manual review).

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
//
// NB — Paystack's /bank/resolve endpoint does NOT support ZAR yet, so we skip
// the resolve step for SA. Paystack itself validates the account number when we
// call /subaccount and returns a clear error if it's invalid.
type SubaccountResult =
  | { ok: true; subaccountCode: string; bankCode: string }
  | { ok: false; error: string; stage: 'bank_lookup' | 'paystack_create' }

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

  // 2. Create the Paystack subaccount. Paystack rejects invalid account numbers
  //    here with a specific message, which we surface directly on the vendor.
  try {
    const vendorShare = Math.round((1 - (vendor.commissionRate ?? 0.10)) * 100)
    const result = await paystackPost('/subaccount', {
      business_name:       vendor.storeName,
      settlement_bank:     bankCode,
      account_number:      accountNumber,
      percentage_charge:   vendorShare,
      description:         `${vendor.storeName} — Tolta vendor`,
    })
    if (!result.status || !result.data?.subaccount_code) {
      return { ok: false, error: result.message || 'Paystack refused subaccount creation.', stage: 'paystack_create' }
    }

    await vendorRef.update({
      paystackSubaccountCode: result.data.subaccount_code,
      paystackSubaccountId:   result.data.id,
      paystackBankCode:       bankCode,
      paystackStatus:         'active',
      paystackError:          admin.firestore.FieldValue.delete(),
      paystackErrorStage:     admin.firestore.FieldValue.delete(),
      paystackUpdatedAt:      admin.firestore.FieldValue.serverTimestamp(),
    })

    return { ok: true, subaccountCode: result.data.subaccount_code, bankCode }
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

    return { ok: true, subaccountCode: result.subaccountCode, bankCode: result.bankCode }
  },
)

// ─── 1e. recalculateAllProductPrices (callable, admin-only) ──────────────────
// After admin changes markupRate in settings/business, this walks every product
// and recomputes `price = merchantPrice × (1 + markupRate)`. Batched writes.
export const recalculateAllProductPrices = onCall<Record<string, never>>(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in as admin.')

    const settings = await getBusinessSettings()
    const products = await db.collection('products').get()

    let updated = 0
    let skipped = 0
    let batch = db.batch()
    let batchSize = 0

    for (const doc of products.docs) {
      const d = doc.data()
      const merchant = d.merchantPrice as number | undefined
      // If no merchantPrice yet, back-fill: assume current `price` was the
      // merchant price (grandfather in — no forced markup on legacy products).
      const merchantPrice = merchant ?? (d.price as number) ?? 0
      if (merchantPrice <= 0) { skipped++; continue }

      const newPrice = Math.round(merchantPrice * (1 + settings.markupRate) * 100) / 100
      batch.update(doc.ref, {
        merchantPrice,
        price: newPrice,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      updated++
      batchSize++

      if (batchSize >= 400) { // Firestore batch limit is 500
        await batch.commit()
        batch = db.batch()
        batchSize = 0
      }
    }
    if (batchSize > 0) await batch.commit()

    console.log(`Recalculated ${updated} products (skipped ${skipped}) at ${(settings.markupRate * 100).toFixed(1)}% markup`)
    return { updated, skipped, markupRate: settings.markupRate }
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

  const { vendorId, items, email, deliveryAddress,
          deliveryLat, deliveryLng, deliveryDistanceKm } = req.body as {
    vendorId: string
    email: string
    items: Array<{ name: string; quantity: number; price: number; merchantPrice?: number; productId?: string }>
    deliveryAddress: string
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

  // Load business settings — single source of truth
  const settings = await getBusinessSettings()

  // Server-side authoritative delivery fee — never trust the client-supplied one
  const distanceKm = deliveryDistanceKm ?? 0
  const deliveryFee = Math.round(
    (settings.deliveryFeeBase + distanceKm * settings.deliveryFeePerKm) * 100,
  ) / 100

  // Subtotal (customer-facing prices, i.e. displayed prices with markup baked in)
  const subtotal = items.reduce((sum, i) => sum + (i.price * i.quantity), 0)
  const amountRands = Math.round((subtotal + deliveryFee) * 100) / 100

  const reference       = `TB-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`
  const amountKobo      = Math.round(amountRands * 100)
  const deliveryFeeKobo = Math.round(deliveryFee * 100)

  // Split the money correctly:
  //   Vendor gets = sum(merchantPrice × qty)                     → subaccount → vendor's bank
  //   Tolta gets  = sum((displayedPrice − merchantPrice) × qty)  + delivery fee → platform balance
  //   Tolta then pays driver:   deliveryFee × (1 − driverCommissionRate)
  //   Tolta keeps net:           markup + (deliveryFee × driverCommissionRate) − Paystack fee
  const markupPerCartKobo = items.reduce((sum, i) => {
    // Fallback: if merchantPrice missing (legacy product), assume no markup
    const merch = (i.merchantPrice ?? i.price) * 100
    const displayed = i.price * 100
    return sum + Math.max(0, Math.round((displayed - merch) * i.quantity))
  }, 0)
  const platformFeeKobo   = markupPerCartKobo + deliveryFeeKobo // what Tolta keeps

  // Create order in Firestore first
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
      ready:      { title: '📦 Ready for pickup',   body: 'Your order is packed. Finding you a driver now.' },
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
  // Helper — mark the order as awaiting a driver and (optionally) tell the
  // consumer we're looking. Called whenever assignment can't complete.
  const markUnassigned = async (reason: string) => {
    console.warn(`Order ${orderId} unassigned: ${reason}`)
    await orderRef.update({
      assignmentStatus:      'unassigned',
      assignmentError:       reason,
      assignmentAttemptedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:             admin.firestore.FieldValue.serverTimestamp(),
    })
    // Let the consumer know so they don't panic when the driver doesn't appear
    try {
      const orderSnap = await orderRef.get()
      const userId = orderSnap.data()?.userId as string | undefined
      if (userId && userId !== 'guest') {
        await sendFCM(
          userId,
          'Looking for a driver…',
          "We're finding a nearby driver for your order. This may take a few minutes.",
          { orderId, type: 'awaiting_driver' },
        )
      }
    } catch (_) { /* best-effort notification */ }
  }

  // All online drivers
  const trackingSnap = await db.collection('tracking_sessions')
    .where('isActive', '==', true)
    .get()

  if (trackingSnap.empty) {
    await markUnassigned('No drivers currently online')
    return false
  }

  const allOnline = trackingSnap.docs
    .map(d => ({ id: d.id, lat: d.data().lat as number, lng: d.data().lng as number }))
    .filter(d => !excludeDriverIds.includes(d.id))

  if (allOnline.length === 0) {
    await markUnassigned('All online drivers have declined this order')
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
    await markUnassigned('All online drivers are currently on other deliveries')
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
    deliveryStatus:        'assigned',
    assignmentStatus:      'assigned',
    assignmentError:       admin.firestore.FieldValue.delete(),
    assignmentAttemptedAt: admin.firestore.FieldValue.delete(),
    assignedAt:            admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:             admin.firestore.FieldValue.serverTimestamp(),
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

// ─── 6c. retryUnassignedOnDriverOnline ────────────────────────────────────────
// Fires when a driver's tracking_sessions doc flips isActive → true (goes
// online). Sweeps for any 'ready' orders that failed to find a driver earlier
// and tries to hand them to the newly-online driver.
export const retryUnassignedOnDriverOnline = onDocumentUpdated(
  'tracking_sessions/{driverId}',
  async (event) => {
    const before = event.data?.before.data()
    const after  = event.data?.after.data()
    if (!before || !after) return

    // Only fire on the transition offline → online
    if (before.isActive === true) return
    if (after.isActive  !== true) return

    // Find unassigned 'ready' orders — batched read (max 10 per query is fine,
    // no unassigned should normally be sitting around anyway)
    const stuckSnap = await db.collection('orders')
      .where('status', '==', 'ready')
      .where('assignmentStatus', '==', 'unassigned')
      .limit(10)
      .get()

    if (stuckSnap.empty) return

    console.log(`Driver ${event.params.driverId} online — retrying ${stuckSnap.size} unassigned order(s)`)

    for (const doc of stuckSnap.docs) {
      const order = doc.data()
      // Exclude drivers that already declined this specific order
      const excluded = (order.declinedBy as string[] | undefined) ?? []
      await findAndAssignDriver(
        doc.id,
        doc.ref,
        order.vendorId as string,
        excluded,
      )
    }
  },
)

// ─── 6d. retryOrderAssignment (callable, admin-only) ──────────────────────────
// Admin dashboard can force a re-assignment on any stuck order.
export const retryOrderAssignment = onCall<{ orderId: string }>(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in as admin.')
    const { orderId } = request.data
    if (!orderId) throw new HttpsError('invalid-argument', 'orderId required.')

    const orderRef = db.collection('orders').doc(orderId)
    const snap = await orderRef.get()
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found.')
    const order = snap.data()!
    if (order.status !== 'ready') {
      throw new HttpsError('failed-precondition', `Order status is "${order.status}", not "ready".`)
    }
    if (order.driverId) {
      return { ok: true, alreadyAssigned: true, driverId: order.driverId }
    }

    const excluded = (order.declinedBy as string[] | undefined) ?? []
    const ok = await findAndAssignDriver(
      orderId,
      orderRef,
      order.vendorId as string,
      excluded,
    )
    return { ok, retried: true }
  },
)

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

  // Driver earnings = deliveryFee × (1 − driverCommissionRate).
  // Tolta keeps driverCommissionRate as platform revenue on the delivery.
  const settings = await getBusinessSettings()
  const deliveryFee = (after.deliveryFee as number) ?? 0
  const driverPayout = Math.round(
    deliveryFee * (1 - settings.driverCommissionRate) * 100,
  ) / 100

  // Write earnings record
  await db.collection('driver_earnings').add({
    driverId,
    orderId,
    amount:                driverPayout,
    deliveryFee,
    commissionRate:        settings.driverCommissionRate,
    platformCommissionAmount: Math.round((deliveryFee - driverPayout) * 100) / 100,
    type:                  'delivery',
    status:                'pending_payout',
    createdAt:             admin.firestore.FieldValue.serverTimestamp(),
  })

  // Update wallet balance — this is what the wallet screen reads
  await db.collection('drivers').doc(driverId)
    .collection('wallet').doc('main')
    .set({
      balance:        admin.firestore.FieldValue.increment(driverPayout),
      totalEarned:    admin.firestore.FieldValue.increment(driverPayout),
      pendingPayout:  admin.firestore.FieldValue.increment(driverPayout),
      updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })

  // Notify driver
  await sendFCMToDriver(
    driverId,
    '💰 Delivery Complete!',
    `R${driverPayout.toFixed(2)} added to your wallet.`,
    { orderId, type: 'earnings_added', amount: String(driverPayout) },
  )

  console.log(`Earnings R${driverPayout.toFixed(2)} recorded for driver ${driverId} on order ${orderId} (delivery R${deliveryFee}, commission ${(settings.driverCommissionRate * 100).toFixed(1)}%)`)
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
