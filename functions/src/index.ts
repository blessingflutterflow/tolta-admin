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

// ─── FCM helper ───────────────────────────────────────────────────────────────
async function sendFCM(userId: string, title: string, body: string, data?: Record<string, string>) {
  try {
    const userSnap = await db.collection('users').doc(userId).get()
    const token = userSnap.data()?.fcmToken as string | undefined
    if (!token) return
    await admin.messaging().send({ token, notification: { title, body }, data })
  } catch (e) {
    console.error('FCM error:', e)
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
        await sendFCM(
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

  const { vendorId, amountRands, email, items, deliveryAddress, deliveryFee } = req.body as {
    vendorId: string
    amountRands: number
    email: string
    items: Array<{ name: string; quantity: number; price: number }>
    deliveryAddress: string
    deliveryFee: number
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
      await sendFCM(
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
      placed:     { title: '✅ Order confirmed!',   body: 'Your order has been confirmed.' },
      preparing:  { title: '👨‍🍳 Being prepared',    body: 'The vendor is packing your order.' },
      ready:      { title: '📦 Ready for pickup',   body: 'Your order is packed and ready.' },
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
