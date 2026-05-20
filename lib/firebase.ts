import { initializeApp, getApps } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyB4mrbV9MJF_Hj-BQjORG44OsiKQuTPVHs',
  authDomain: 'tolta-b7ece.firebaseapp.com',
  projectId: 'tolta-b7ece',
  storageBucket: 'tolta-b7ece.firebasestorage.app',
  messagingSenderId: '118601608816',
  appId: '1:118601608816:web:98ca8636dda9bc54038eb5',
  measurementId: 'G-GXKSFTKPTZ',
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]

export const auth = getAuth(app)
export const db = getFirestore(app)
export default app
