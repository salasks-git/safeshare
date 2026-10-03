import re

home_jsx = """import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { createRoom, joinRoom } from '../js/api.js';
import { t, getLang, setLang } from '../js/i18n.js';

export default function Home() {
  const navigate = useNavigate();
  const [lang, setLangState] = useState(getLang());
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [code, setCode] = useState(() => {
    const preCode = new URLSearchParams(window.location.search).get('code') || '';
    if (/^\d{6}$/.test(preCode)) {
      return preCode.split('');
    }
    return ['', '', '', '', '', ''];
  });
  const inputRefs = useRef([]);

  const handleLangChange = (e) => {
    const l = e.target.value;
    setLang(l);
    setLangState(l);
  };

  const handleCreate = async () => {
    setCreateError('');
    setIsCreating(true);
    try {
      const result = await createRoom();
      if (result.ok && result.data.code) {
        sessionStorage.setItem('sd_role', 'host');
        navigate(`/wait?code=${result.data.code}`);
      } else if (result.status === 429) {
        setCreateError(t('error_rate_limited'));
      } else {
        setCreateError('Could not create room. Please try again.');
      }
    } catch {
      setCreateError('Network error. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoin = async () => {
    const fullCode = code.join('');
    setJoinError('');
    if (!/^\d{6}$/.test(fullCode)) {
      setJoinError('Please enter the full 6-digit code.');
      return;
    }
    setIsJoining(true);
    try {
      const result = await joinRoom(fullCode);
      if (result.ok) {
        sessionStorage.setItem('sd_role', 'guest');
        navigate(`/room?code=${result.data.code}`);
      } else if (result.status === 404) {
        setJoinError(t('error_not_found'));
      } else if (result.status === 429) {
        setJoinError(t('error_rate_limited'));
      } else {
        setJoinError('Could not join room. Please try again.');
      }
    } catch {
      setJoinError('Network error. Please try again.');
    } finally {
      setIsJoining(false);
    }
  };

  const handleDigitChange = (index, value) => {
    const val = value.replace(/\D/g, '').slice(-1);
    const newCode = [...code];
    newCode[index] = val;
    setCode(newCode);
    if (val && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleDigitPaste = (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
    const newCode = [...code];
    text.split('').slice(0, 6).forEach((ch, i) => {
      if (i < 6) newCode[i] = ch;
    });
    setCode(newCode);
    const last = Math.min(text.length, 5);
    inputRefs.current[last]?.focus();
  };

  return (
    <div className="bg-[#F3F3F3] text-brand-dark min-h-screen flex flex-col justify-between selection:bg-brand-lime selection:text-brand-dark">
      <header className="w-full max-w-5xl mx-auto px-6 pt-8 pb-4 flex items-center justify-between" data-purpose="site-header">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-brand-dark flex items-center justify-center text-white shadow-brutal-sm border border-brand-dark">
            <svg className="w-6 h-6 text-brand-lime" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <rect height="11" rx="2" ry="2" width="18" x="3" y="11"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight leading-none text-brand-dark">{t('app_name')}</h1>
            <p className="text-xs font-medium text-brand-muted tracking-wide mt-1">{t('tagline')}</p>
          </div>
        </div>
        <div className="flex items-center relative">
          <select
            id="lang-select"
            value={lang}
            onChange={handleLangChange}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          >
            <option value="en">English</option>
            <option value="ml">മലയാളം</option>
            <option value="hi">हिन्दी</option>
          </select>
          <button className="flex items-center gap-2.5 bg-white border-[1.5px] border-brand-dark py-2 px-4 rounded-xl shadow-brutal-sm hover:bg-brand-lime/20 transition-colors" type="button">
            <svg className="w-4 h-4 text-brand-dark" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="2" x2="22" y1="12" y2="12"></line>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
            <span className="text-sm font-semibold">{lang === 'ml' ? 'മലയാളം' : lang === 'hi' ? 'हिन्दी' : 'English'}</span>
            <svg className="w-3.5 h-3.5 text-brand-dark ml-0.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        </div>
      </header>

      <main className="flex-grow flex items-center justify-center py-6 px-4">
        <div className="w-full max-w-2xl mx-auto space-y-7">
          <section className="text-left space-y-3" data-purpose="hero-intro">
            <div className="inline-flex items-center gap-2 bg-brand-lime text-brand-dark font-bold text-xs md:text-sm px-3.5 py-1 rounded-md border border-brand-dark tracking-wide">
              <span className="w-2 h-2 rounded-full bg-brand-dark animate-pulse"></span>
              Instant Device Pairing
            </div>
            <h2 className="text-3xl md:text-4xl lg:text-[40px] font-bold tracking-tight text-brand-dark leading-[1.15]">
              Connect two devices.<br/>Share files instantly.
            </h2>
            <p className="text-brand-muted text-base md:text-lg font-normal">
              No login. No install. Files vanish when you're done.
            </p>
          </section>

          <section className="bg-white rounded-3xl p-6 sm:p-8 border-[1.5px] border-brand-dark shadow-brutal transition-all" data-purpose="create-room-card">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-brand-gray border border-brand-dark/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-brand-dark" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" x2="12" y1="8" y2="16"></line>
                  <line x1="8" x2="16" y1="12" y2="12"></line>
                </svg>
              </div>
              <div>
                <h3 className="text-xl font-bold text-brand-dark tracking-tight">{t('create_room')}</h3>
                <p className="text-brand-muted text-sm mt-0.5">{t('create_desc')}</p>
              </div>
            </div>
            {createError && <div className="text-red-500 text-sm mb-2">{createError}</div>}
            <button disabled={isCreating} onClick={handleCreate} className="action-btn w-full py-4 px-6 rounded-2xl bg-brand-dark text-white font-semibold flex items-center justify-center gap-3 border-[1.5px] border-brand-dark shadow-brutal-sm hover:bg-black group" type="button">
              <span className="px-2 py-0.5 text-xs font-mono font-bold bg-brand-lime text-brand-dark rounded border border-brand-dark group-hover:scale-105 transition-transform">123</span>
              <span className="text-base tracking-wide">{isCreating ? '…' : t('get_code')}</span>
            </button>
          </section>

          <section className="bg-white rounded-3xl p-6 sm:p-8 border-[1.5px] border-brand-dark shadow-brutal transition-all" data-purpose="join-room-card">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-brand-gray border border-brand-dark/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-brand-dark" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                  <polyline points="10 17 15 12 10 7"></polyline>
                  <line x1="15" x2="3" y1="12" y2="12"></line>
                </svg>
              </div>
              <div>
                <h3 className="text-xl font-bold text-brand-dark tracking-tight">{t('join_room')}</h3>
                <p className="text-brand-muted text-sm mt-0.5">{t('join_desc')}</p>
              </div>
            </div>
            <div className="grid grid-cols-6 gap-2.5 sm:gap-3.5 mb-6" data-purpose="otp-container">
              {[0,1,2,3,4,5].map(i => (
                <input
                  key={i}
                  ref={el => inputRefs.current[i] = el}
                  value={code[i]}
                  onChange={(e) => handleDigitChange(i, e.target.value)}
                  onKeyDown={(e) => handleDigitKeyDown(i, e)}
                  onPaste={i === 0 ? handleDigitPaste : undefined}
                  className="otp-input w-full aspect-[4/5] sm:h-16 text-center text-xl sm:text-2xl font-bold bg-white text-brand-dark border-2 border-brand-dark rounded-xl transition-all shadow-[2px_2px_0px_0px_#191A23]"
                  inputMode="numeric" maxLength="1" placeholder="·" type="text"
                />
              ))}
            </div>
            {joinError && <div className="text-red-500 text-sm mb-2">{joinError}</div>}
            <button disabled={isJoining} onClick={handleJoin} className="action-btn w-full py-4 px-6 rounded-2xl bg-brand-dark text-white font-semibold flex items-center justify-center gap-3 border-[1.5px] border-brand-dark shadow-brutal-sm hover:bg-black group" type="button">
              <svg className="w-5 h-5 text-brand-lime transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <line x1="5" x2="19" y1="12" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
              <span className="text-base tracking-wide">{isJoining ? '…' : t('connect')}</span>
            </button>
          </section>
        </div>
      </main>

      <footer className="w-full max-w-5xl mx-auto px-6 py-8 border-t border-brand-dark/10 mt-8" data-purpose="site-footer">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm font-medium text-brand-muted">
          <div className="flex items-center gap-2 text-brand-dark">
            <svg className="w-5 h-5 text-brand-dark fill-brand-lime" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
            <span className="font-semibold text-brand-dark">{t('end_to_end')}</span>
          </div>
          <div className="flex items-center gap-6">
            <Link className="hover:text-brand-dark transition-colors underline decoration-brand-dark/30 underline-offset-4" to="/privacy">{t('privacy')}</Link>
            <span className="w-1.5 h-1.5 rounded-full bg-brand-dark/30"></span>
            <a className="hover:text-brand-dark transition-colors underline decoration-brand-dark/30 underline-offset-4" href="mailto:abuse@example.com">{t('report_abuse')}</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
"""

with open('frontend/src/components/Home.jsx', 'w') as f:
    f.write(home_jsx)

