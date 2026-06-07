export const metadata = {
  title: 'Privacy Policy - Tolta',
  description: 'Privacy Policy for the Tolta grocery delivery app',
}

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-10">Last updated: June 2026</p>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">1. Introduction</h2>
          <p className="text-gray-600 leading-relaxed">
            Tolta (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) is a grocery delivery marketplace operated by Lokale Group (Pty) Ltd,
            registered in South Africa. This Privacy Policy explains how we collect, use, and protect your
            personal information when you use the Tolta mobile application.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">2. Information We Collect</h2>
          <ul className="list-disc list-inside text-gray-600 space-y-2">
            <li><strong>Phone number</strong> — used to create and verify your account via OTP</li>
            <li><strong>Location data</strong> — used to find nearby vendors and calculate delivery routes</li>
            <li><strong>Order history</strong> — used to display your past orders and enable reordering</li>
            <li><strong>Device information</strong> — used for push notifications and app performance</li>
            <li><strong>Profile information</strong> — name and delivery address you provide</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">3. How We Use Your Information</h2>
          <ul className="list-disc list-inside text-gray-600 space-y-2">
            <li>To process and deliver your grocery orders</li>
            <li>To send order status notifications via push notifications</li>
            <li>To enable real-time order tracking on the map</li>
            <li>To connect you with local vendors in your area</li>
            <li>To improve our services and fix issues</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">4. Data Sharing</h2>
          <p className="text-gray-600 leading-relaxed">
            We share your delivery address and name with the vendor fulfilling your order and the driver
            delivering it. We do not sell your personal data to third parties. We use Firebase (Google)
            for authentication, database, and push notifications.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">5. Location Data</h2>
          <p className="text-gray-600 leading-relaxed">
            Tolta requests access to your device location to show nearby vendors and enable delivery tracking.
            Location is only accessed while using the app. We do not track your location in the background
            without your knowledge.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">6. Data Retention</h2>
          <p className="text-gray-600 leading-relaxed">
            We retain your account data for as long as your account is active. You may request deletion of
            your account and associated data by contacting us at the email below.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">7. Your Rights</h2>
          <p className="text-gray-600 leading-relaxed">
            Under POPIA (Protection of Personal Information Act, South Africa), you have the right to access,
            correct, or delete your personal information. To exercise these rights, contact us at:
          </p>
          <p className="mt-3 text-gray-700 font-medium">info@lokaleapp.co.za</p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">8. Security</h2>
          <p className="text-gray-600 leading-relaxed">
            We use industry-standard security measures including Firebase Authentication and encrypted
            data transmission to protect your information.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">9. Changes to This Policy</h2>
          <p className="text-gray-600 leading-relaxed">
            We may update this policy from time to time. We will notify you of significant changes via
            the app. Continued use of Tolta after changes constitutes acceptance of the updated policy.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-800 mb-3">10. Contact Us</h2>
          <p className="text-gray-600">Lokale Group (Pty) Ltd</p>
          <p className="text-gray-600">34 8th Avenue, Joe Nhlanhla, Johannesburg, 2090, South Africa</p>
          <p className="text-gray-600">Email: info@lokaleapp.co.za</p>
          <p className="text-gray-600">Phone: +27 72 125 8282</p>
        </section>
      </div>
    </div>
  )
}