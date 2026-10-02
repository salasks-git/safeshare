import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { createRoom, joinRoom } from '../js/api.js';
import { t, getLang, setLang } from '../js/i18n.js';

export default function Home() {
  const navigate = useNavigate();

  // i18n: force re-render when language changes
  const [lang, setLangState] = useState(getLang());

  // State for Create Room
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // State for Join Room
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

  useEffect(() => {
    // Initialized in useState
  }, []);

  const handleLangChange = (e) => {
    const l = e.target.value;
    setLang(l);
    setLangState(l); // triggers re-render with new language
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
    <>
      <header className="fixed top-0 w-full z-50 pt-safe bg-surface/90 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.03)]">
        <div className="h-16 max-w-xl mx-auto px-margin-mobile flex items-center justify-between">
          <div className="flex items-center gap-space-sm">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 shadow-sm" style={{backgroundColor: '#141722'}}>
              <span className="material-symbols-outlined text-[20px]">lock</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[17px] font-semibold text-on-surface leading-none tracking-tight">{t('app_name')}</span>
              <span className="text-[11px] text-on-surface-variant mt-0.5">{t('tagline')}</span>
            </div>
          </div>
          <div className="flex items-center">
            <label className="sr-only" htmlFor="lang-select">Language</label>
            <div className="flex items-center gap-1.5 h-10 px-3.5 rounded-full bg-surface-container border border-outline-variant/40 text-on-surface-variant focus-within:ring-2 focus-within:ring-primary-container">
              <span className="material-symbols-outlined text-[18px] text-on-surface-variant">translate</span>
              <select
                id="lang-select"
                value={lang}
                onChange={handleLangChange}
                className="bg-transparent text-[13px] font-medium text-on-surface focus:outline-none pr-1 appearance-none cursor-pointer"
              >
                <option value="en">English</option>
                <option value="ml">മലയാളം</option>
                <option value="hi">हिन्दी</option>
              </select>
              <span className="material-symbols-outlined text-[16px] text-on-surface-variant pointer-events-none">expand_more</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-start w-full pt-20 pb-20 bg-surface px-margin-mobile">
        <div className="w-full max-w-xl flex flex-col my-auto py-space-sm gap-space-md">
          <div className="flex flex-col gap-1.5 px-0.5 text-left">
            <div className="inline-flex items-center gap-2 self-start px-3 py-1 rounded-full mb-1 border border-[#10B981]/20" style={{backgroundColor: 'rgb(236,253,245)', color: 'rgb(6,95,70)'}}>
              <span className="w-2 h-2 rounded-full" style={{backgroundColor: '#10B981'}}></span>
              <span className="text-[12px] font-semibold tracking-tight">Instant Device Pairing</span>
            </div>
            <h1 className="text-[26px] font-semibold text-on-surface tracking-tight leading-tight">Connect two devices.<br />Share files instantly.</h1>
            <p className="text-[15px] text-on-surface-variant leading-relaxed">No login. No install. Files vanish when you&apos;re done.</p>
          </div>

          <div className="flex flex-col gap-3.5 w-full">
            {/* Create Room Card */}
            <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/40 p-space-md shadow-sm flex flex-col gap-3.5">
              <div className="flex items-start gap-3.5">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{backgroundColor: '#F0F2F7', color: '#141722'}}>
                  <span className="material-symbols-outlined text-[24px]">add_circle</span>
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <h2 className="text-[15px] font-semibold text-on-surface">{t('create_room')}</h2>
                  <p className="text-[13px] text-on-surface-variant mt-0.5 leading-snug">{t('create_desc')}</p>
                </div>
              </div>

              <div className="error-msg" role="alert" aria-live="polite">{createError}</div>
              <button disabled={isCreating} className="btn-primary mt-1" type="button" onClick={handleCreate}>
                <span className="material-symbols-outlined text-[20px]">pin</span>
                <span>{isCreating ? '…' : t('get_code')}</span>
              </button>
            </div>

            {/* Join Room Card */}
            <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/40 p-space-md shadow-sm flex flex-col gap-3.5">
              <div className="flex items-start gap-3.5">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{backgroundColor: '#F0F2F7', color: '#141722'}}>
                  <span className="material-symbols-outlined text-[24px]">login</span>
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <h2 className="text-[15px] font-semibold text-on-surface">{t('join_room')}</h2>
                  <p className="text-[13px] text-on-surface-variant mt-0.5 leading-snug">{t('join_desc')}</p>
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 my-1" role="group" aria-label="Enter 6-digit code">
                {[0, 1, 2, 3, 4, 5].map(i => (
                  <input
                    key={i}
                    ref={el => inputRefs.current[i] = el}
                    value={code[i]}
                    onChange={(e) => handleDigitChange(i, e.target.value)}
                    onKeyDown={(e) => handleDigitKeyDown(i, e)}
                    onPaste={i === 0 ? handleDigitPaste : undefined}
                    className="digit-input"
                    aria-label={`Digit ${i + 1}`}
                    inputMode="numeric"
                    maxLength="1"
                    type="text"
                    autoComplete="off"
                  />
                ))}
              </div>

              <div className="error-msg" role="alert" aria-live="polite">{joinError}</div>
              <button disabled={isJoining} className="btn-primary" type="button" onClick={handleJoin}>
                <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
                <span>{isJoining ? '…' : t('connect')}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 w-full pt-1">
            <div className="flex flex-col items-center text-center p-3 rounded-2xl bg-surface-container-lowest border border-outline-variant/30 shadow-sm">
              <div className="w-8 h-8 rounded-full flex items-center justify-center mb-1.5" style={{backgroundColor: '#F0F2F7', color: '#141722'}}>
                <span className="material-symbols-outlined text-[18px]">person_off</span>
              </div>
              <span className="text-[11px] font-medium text-on-surface leading-tight">{t('no_account')}</span>
            </div>
            <div className="flex flex-col items-center text-center p-3 rounded-2xl bg-surface-container-lowest border border-outline-variant/30 shadow-sm">
              <div className="w-8 h-8 rounded-full flex items-center justify-center mb-1.5" style={{backgroundColor: '#F0F2F7', color: '#141722'}}>
                <span className="material-symbols-outlined text-[18px]">visibility_off</span>
              </div>
              <span className="text-[11px] font-medium text-on-surface leading-tight">{t('view_only')}</span>
            </div>
            <div className="flex flex-col items-center text-center p-3 rounded-2xl bg-surface-container-lowest border border-outline-variant/30 shadow-sm">
              <div className="w-8 h-8 rounded-full flex items-center justify-center mb-1.5" style={{backgroundColor: '#F0F2F7', color: '#141722'}}>
                <span className="material-symbols-outlined text-[18px]">auto_delete</span>
              </div>
              <span className="text-[11px] font-medium text-on-surface leading-tight">{t('auto_deletes')}</span>
            </div>
          </div>
        </div>
      </main>

      <footer className="fixed bottom-0 w-full z-40 pb-safe bg-surface/90 backdrop-blur-md shadow-[0_-1px_6px_rgba(0,0,0,0.02)]">
        <div className="h-12 max-w-xl mx-auto px-margin-mobile flex items-center justify-between text-on-surface-variant text-[12px]">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]" style={{color: '#0f766e'}}>verified_user</span>
            <span>{t('end_to_end')}</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Use Link for SPA navigation — no full page reload */}
            <Link className="hover:underline text-on-surface-variant" to="/privacy">{t('privacy')}</Link>
            <span className="w-1 h-1 rounded-full bg-outline-variant"></span>
            <a className="hover:underline text-on-surface-variant" href="mailto:abuse@example.com?subject=Safe-Drop+Abuse+Report">{t('report_abuse')}</a>
          </div>
        </div>
      </footer>
    </>
  );
}
