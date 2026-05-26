/**
 * Tolta Admin Seed Script
 * Creates the admin Firebase Auth user via REST API (no service account needed)
 *
 * Usage:
 *   node scripts/seed-admin.js <email> <password>
 *
 * Example:
 *   node scripts/seed-admin.js admin@tolta.app Admin@12345
 *
 * Requirements:
 *   - Email/Password sign-in must be enabled in Firebase Console
 *     → Authentication → Sign-in method → Email/Password → Enable
 */

const https = require('https')

const API_KEY = 'AIzaSyB4mrbV9MJF_Hj-BQjORG44OsiKQuTPVHs'
const PROJECT_ID = 'tolta-b7ece'

const email = process.argv[2]
const password = process.argv[3]

if (!email || !password) {
  console.error('Usage: node scripts/seed-admin.js <email> <password>')
  console.error('Example: node scripts/seed-admin.js admin@tolta.app Admin@12345')
  process.exit(1)
}

if (password.length < 6) {
  console.error('Password must be at least 6 characters.')
  process.exit(1)
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const urlObj = new URL(url)
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }
    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', chunk => body += chunk)
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }))
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

async function main() {
  console.log(`\nCreating admin user for project: ${PROJECT_ID}`)
  console.log(`Email: ${email}\n`)

  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`

  const { status, body } = await post(url, {
    email,
    password,
    returnSecureToken: false,
  })

  if (status === 200) {
    console.log('✅ Admin user created successfully!')
    console.log(`   Email: ${email}`)
    console.log(`   UID:   ${body.localId}`)
    console.log('\nYou can now sign in at the Tolta Admin dashboard.')
  } else {
    const code = body?.error?.message ?? 'UNKNOWN'
    if (code === 'EMAIL_EXISTS') {
      console.log('ℹ️  User already exists with this email.')
      console.log('   If you forgot the password, reset it in Firebase Console → Authentication.')
    } else if (code === 'OPERATION_NOT_ALLOWED') {
      console.error('❌ Email/Password sign-in is not enabled.')
      console.error('   Go to Firebase Console → Authentication → Sign-in method → Email/Password → Enable')
    } else if (code === 'WEAK_PASSWORD : Password should be at least 6 characters') {
      console.error('❌ Password too weak. Use at least 6 characters.')
    } else {
      console.error(`❌ Failed to create user: ${code}`)
    }
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Unexpected error:', err.message)
  process.exit(1)
})
