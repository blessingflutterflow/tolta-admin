import * as admin from 'firebase-admin'
import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https'
import axios from 'axios'
import * as crypto from 'crypto'

admin.initializeApp()
const db = admin.firestore()

const PAYSTACK_KEY = process.env.PAYSTACK_SECRET_KEY || ''
const PAYSTACK_API = 'https://api.paystack.co'

// ─── Bank code lookup (SA banks on Paystack) ──────────────────────────────────
const BANK_CODES: Record<string, string> = {
  'Capitec':        '470010',
  'FNB':            '250655',
  'Standard Bank':  '051001',
  'Absa':           '632005',
  'Nedbank':        '198765',
  'African Bank':   '430000',
  'TymeBank':       '678910',
  'Discovery Bank': '679000',
}

// ─── Paystack helpers ─────────────────────────────────────────────────────────
const paystackHeaders = {
  Authorization: `Bearer ${PAYSTACK_KEY}`,
  'Content-Type': 'application/json',
}

async function paystackPost(path: string, body: object) {
  const res = await axios.post(`${PAYSTACK_API}${path}`, body, { headers: paystackHeaders })
  return res.data
}

async function paystackPut(path: string, body: object) {
  const res = await axios.put(`${PAYSTACK_API}${path}`, body, { headers: paystackHeaders })
  return res.data
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

// ─── 1. createVendorSubaccount ────────────────────────────────────────────────
// Triggered when admin approves a vendor (status: pending → active)
export const createVendorSubaccount = onDocumentUpdated(
  'vendors/{vendorId}',
  async (event) => {
    const before = event.data?.before.data()
    const after  = event.data?.after.data()
    if (!before || !after) return

    // Only fire when status changes to 'active' for the first time
    if (before.status === after.status) return
    if (after.status !== 'active') return
    if (after.paystackSubaccountCode) return // already created

    const bankCode = BANK_CODES[after.bankDetails?.bankName]
    if (!bankCode) {
      console.error(`Unknown bank: ${after.bankDetails?.bankName}`)
      return
    }

    try {
      const vendorShare = Math.round((1 - (after.commissionRate ?? 0.10)) * 100)

      const result = await paystackPost('/subaccount', {
        business_name:       after.storeName,
        settlement_bank:     bankCode,
        account_number:      after.bankDetails.accountNumber,
        percentage_charge:   vendorShare,
        settlement_schedule: 'auto', // T+1 — vendor gets paid same time as Tolta
        description:         `${after.storeName} — Tolta vendor`,
      })

      if (result.status) {
        await event.data!.after.ref.update({
          paystackSubaccountCode: result.data.subaccount_code,
          paystackSubaccountId:   result.data.id,
          paystackUpdatedAt:      admin.firestore.FieldValue.serverTimestamp(),
        })
        console.log(`Subaccount created for ${after.storeName}: ${result.data.subaccount_code}`)

        // Notify vendor
        await sendFCMToVendor(
          event.params.vendorId,
          '🎉 You\'re approved!',
          'Your Tolta vendor account is live. Start adding products!',
          { type: 'vendor_approved' }
        )
      }
    } catch (e) {
      console.error('Subaccount creation failed:', e)
    }
  }
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
