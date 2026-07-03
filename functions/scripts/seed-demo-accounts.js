/**
 * Seed Play Store / App Store review demo accounts.
 *
 * For each demo phone number this script:
 *   1. Computes the deterministic UID (same SHA-256 hash as createPhoneAuthToken)
 *   2. Creates the Firebase Auth user (idempotent)
 *   3. Pre-populates the Firestore docs so the reviewer lands on a working
 *      home screen instead of an onboarding form.
 *
 * Usage (run from tolta-admin/functions/):
 *   node scripts/seed-demo-accounts.js <path-to-service-account.json>
 *
 * Example:
 *   node scripts/seed-demo-accounts.js ../../tolta-498717-80af485a96e4.json
 */

const admin = require('firebase-admin')
const crypto = require('crypto')
const path = require('path')

const saPath = process.argv[2]
if (!saPath) {
  console.error('Usage: node scripts/seed-demo-accounts.js <path-to-service-account.json>')
  process.exit(1)
}

admin.initializeApp({
  credential: admin.credential.cert(require(path.resolve(saPath))),
})

const db = admin.firestore()

// Match createPhoneAuthToken in functions/src/index.ts exactly.
function uidFor(phone) {
  return crypto.createHash('sha256').update(phone).digest('hex').substring(0, 28)
}

async function ensureAuthUser(uid, phone) {
  try {
    await admin.auth().getUser(uid)
    console.log(`   ✓ Auth user exists: ${uid}`)
  } catch (_) {
    await admin.auth().createUser({ uid, phoneNumber: phone })
    console.log(`   + Created Auth user: ${uid}`)
  }
}

async function seedConsumer(phone) {
  console.log(`\n[Consumer] ${phone}`)
  const uid = uidFor(phone)
  await ensureAuthUser(uid, phone)
  await db.collection('users').doc(uid).set({
    name: 'Demo Reviewer',
    phone,
    role: 'consumer',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })
  console.log(`   ✓ users/${uid} seeded`)
}

async function seedVendor(phone) {
  console.log(`\n[Vendor] ${phone}`)
  const uid = uidFor(phone)
  await ensureAuthUser(uid, phone)

  await db.collection('users').doc(uid).set({
    name: 'Demo Vendor',
    phone,
    role: 'vendor',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })

  await db.collection('vendors').doc(uid).set({
    ownerId: uid,
    storeName: 'Demo Spaza',
    storeType: 'Spaza Shop',
    address: '123 Sample St, Sandton, Johannesburg',
    location: new admin.firestore.GeoPoint(-26.1076, 28.0567),
    lat: -26.1076,
    lng: 28.0567,
    phone,
    isOpen: true,
    deliveryTime: '30-45 min',
    minOrder: 50,
    status: 'active',
    commissionRate: 0.10,
    idNumber: '0000000000000',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })

  // One sample product so the storefront isn't empty
  await db.collection('products').doc(`demo-${uid}`).set({
    vendorId: uid,
    name: 'Demo Maize Meal 2.5kg',
    description: 'Sample product for review',
    price: 49.99,
    stock: 100,
    category: 'Pantry',
    unit: 'each',
    isActive: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })

  console.log(`   ✓ users/${uid}, vendors/${uid}, demo product seeded`)
}

async function seedDriver(phone) {
  console.log(`\n[Driver] ${phone}`)
  const uid = uidFor(phone)
  await ensureAuthUser(uid, phone)

  await db.collection('drivers').doc(uid).set({
    profile: {
      name: 'Demo Driver',
      phone,
      email: 'reviewer@example.com',
      idNumber: '0000000000000',
      licenseNumber: 'DEMO123456',
      vehicleType: 'Motorbike',
      vehicleReg: 'CA-000-000',
    },
    status: 'approved',
    isOnline: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })

  await db.collection('drivers').doc(uid).collection('wallet').doc('main').set({
    balance: 0,
    totalEarned: 0,
    pendingPayout: 0,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })

  console.log(`   ✓ drivers/${uid} seeded with status=approved`)
}

async function main() {
  console.log('Seeding Play Store demo accounts…')
  await seedConsumer('+27110000001')
  await seedVendor('+27110000002')
  await seedDriver('+27110000003')

  console.log('\n────────────────────────────────────────────')
  console.log('Demo credentials for store listings:')
  console.log('   Consumer: +27110000001 / OTP 123456')
  console.log('   Vendor:   +27110000002 / OTP 123456')
  console.log('   Driver:   +27110000003 / OTP 123456')
  console.log('────────────────────────────────────────────\n')
  process.exit(0)
}

main().catch((e) => {
  console.error('Seed failed:', e)
  process.exit(1)
})
