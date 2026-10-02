import React from 'react';
import { Link } from 'react-router-dom';

// Minimal styles for the privacy page
const css = `
  .privacy-wrap { max-width: 720px; margin: 0 auto; padding: 2rem 1.5rem 4rem; font-family: 'Inter', sans-serif; color: #141722; line-height: 1.7; }
  .privacy-wrap a.back { display: inline-flex; align-items: center; gap: 0.5rem; color: #0f766e; text-decoration: none; font-weight: 600; font-size: 0.9rem; margin-bottom: 1.5rem; }
  .privacy-wrap a.back:hover { text-decoration: underline; }
  .privacy-wrap .tag { display: inline-block; font-size: 0.8rem; color: #64748b; border: 1px solid #e2e8f0; border-radius: 9999px; padding: 0.2rem 0.75rem; margin-bottom: 0.75rem; }
  .privacy-wrap h1 { font-size: 1.75rem; font-weight: 800; margin: 0 0 0.5rem; }
  .privacy-wrap h2 { font-size: 1.1rem; font-weight: 700; margin: 2rem 0 0.5rem; }
  .privacy-wrap p { color: #334155; margin: 0 0 0.5rem; }
  .privacy-wrap a { color: #0f766e; }
`;

export default function Privacy() {
  return (
    <>
      <style>{css}</style>
      <div className="privacy-wrap">
        {/* Use React Router Link — no full page reload */}
        <Link className="back" to="/">← Back to Safe-Drop</Link>
        <span className="tag">Last updated: October 2026</span>
        <h1>Privacy Policy &amp; Terms of Use</h1>
        <p>Safe-Drop is a tool for sharing files between two devices without storing them. Please read this page carefully.</p>

        <h2>What we store</h2>
        <p><strong>Nothing you&apos;d expect us to.</strong> We do not collect accounts, emails, phone numbers, or device identifiers. Files are stored temporarily in Cloudflare R2 (a cloud bucket) for the duration of a session — a maximum of 15 minutes of inactivity, or 1 hour absolute. They are then deleted automatically and irreversibly. We have no way to retrieve them after deletion.</p>

        <h2>What &ldquo;view-only&rdquo; means</h2>
        <p>The app has no download button. This reduces accidental retention of files. It is a UI design choice, not technical DRM. The receiving device&apos;s browser may cache pages in memory. Screenshots are always possible. Do not share files you would not want a determined person to save.</p>

        <h2>Logs</h2>
        <p>We do not log codes, tokens, filenames, or file contents. Cloudflare may retain system-level request metadata (IP, timestamp, bytes transferred) for a limited period as described in Cloudflare&apos;s own privacy policy.</p>

        <h2>Cookies</h2>
        <p>We set a single HttpOnly, Secure, SameSite=Strict session cookie for room authentication. It contains your session token (hashed on the server). It is not used for tracking and expires when the session ends.</p>

        <h2>Acceptable use</h2>
        <p>You must not use Safe-Drop to share illegal content, content that violates others&apos; rights, malware, or anything prohibited by law. We reserve the right to terminate sessions suspected of abuse.</p>

        <h2>Legal (India)</h2>
        <p>This service may process personal documents (Aadhaar, PAN, etc.). India&apos;s Digital Personal Data Protection Act 2023 (DPDP Act) may apply. By using this service, you confirm that you have the right to share the files you transfer. This policy is not legal advice.</p>

        <h2>Report abuse</h2>
        <p>To report abuse, email <a href="mailto:abuse@example.com">abuse@example.com</a> with details. We will act promptly.</p>

        <h2>Changes</h2>
        <p>We may update this policy. Continued use after a change constitutes acceptance.</p>
      </div>
    </>
  );
}
