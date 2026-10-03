import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { endSession } from '../js/api.js';
import { createWsManager } from '../js/ws.js';
import { generateQR } from '../js/qr.js';
import { t, getLang, setLang } from '../js/i18n.js';

const TOTAL = 300;

export default function Wait() {
  const navigate = useNavigate();
  const location = useLocation();

  const [code] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get('code');
    return (codeParam && /^\d{6}$/.test(codeParam)) ? codeParam : '';
  });
  const [secondsLeft, setSecondsLeft] = useState(TOTAL);
  const [isEnded, setIsEnded] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [lang, setLangState] = useState(getLang());
  const qrRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const codeParam = params.get('code');

    if (!codeParam || !/^\d{6}$/.test(codeParam)) {
      navigate('/');
      return;
    }

    if (qrRef.current) {
      const qrUrl = `${window.location.origin}/?code=${codeParam}`;
      qrRef.current.innerHTML = '';
      generateQR(qrUrl, qrRef.current);
    }

    const tick = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(tick);
          setIsEnded(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const ws = createWsManager();
    ws.connect(codeParam, {
      onMessage(msg) {
        if (msg.type === 'peer_joined') {
          clearInterval(tick);
          navigate(`/room?code=${codeParam}`);
        }
        if (msg.type === 'ended') {
          clearInterval(tick);
          setIsEnded(true);
        }
      },
      onEnded() {
        clearInterval(tick);
        setIsEnded(true);
      },
      onDisconnect() {},
    });

    return () => {
      clearInterval(tick);
      ws.close();
    };
  }, [location.search, navigate]);

  const handleLangChange = (e) => {
    const l = e.target.value;
    setLang(l);
    setLangState(l);
  };

  const copyCode = () => {
    navigator.clipboard.writeText(code).catch(() => {});
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleCancel = async () => {
    if (!window.confirm(t('cancel_confirm'))) return;
    await endSession(code).catch(() => {});
    navigate('/');
  };

  if (isEnded) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-[#FAFAFA] font-sans text-brand-dark">
        <div className="w-16 h-16 rounded-2xl bg-brand-gray border-2 border-brand-dark flex items-center justify-center mb-4 shadow-brutal-sm">
          <span className="material-symbols-outlined text-[36px] text-brand-dark">schedule</span>
        </div>
        <h1 className="text-2xl font-display font-bold text-brand-dark">Room Expired</h1>
        <p className="text-brand-muted mt-2 mb-6 text-sm max-w-sm">No one joined in time. All data was wiped.</p>
        <button onClick={() => navigate('/')} className="bg-brand-dark text-white border-2 border-brand-dark px-8 py-3 rounded-full font-bold shadow-brutal-sm active:translate-y-0.5 hover:bg-black transition-all">
          {t('start_new')}
        </button>
      </div>
    );
  }

  const m = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
  const s = (secondsLeft % 60).toString().padStart(2, '0');
  const progressPercent = (secondsLeft / TOTAL) * 100;

  return (
    <div className="bg-[#F3F3F3] text-brand-dark min-h-screen flex flex-col justify-between selection:bg-brand-lime selection:text-brand-dark">
      <header className="w-full max-w-5xl mx-auto px-6 pt-8 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-brand-dark flex items-center justify-center text-white shadow-brutal-sm border border-brand-dark">
            <svg className="w-6 h-6 text-brand-lime" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <rect height="11" rx="2" ry="2" width="18" x="3" y="11"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight leading-none text-brand-dark">{t('app_name')}</h1>
            <p className="text-xs font-medium text-brand-muted tracking-wide mt-1">Encrypted P2P Room</p>
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
        <div className="w-full max-w-lg mx-auto flex flex-col space-y-6">
          
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 bg-brand-lime text-brand-dark font-bold text-xs md:text-sm px-4 py-1.5 rounded-full border border-brand-dark tracking-wide shadow-[0px_2px_0px_0px_#191A23]">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-dark opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-brand-dark"></span>
              </span>
              {t('waiting_for_peer')}
            </div>
          </div>

          <section className="bg-white rounded-3xl p-6 sm:p-8 border-[1.5px] border-brand-dark shadow-brutal flex flex-col items-center text-center">
            <h2 className="text-[17px] font-bold text-brand-dark tracking-tight">{t('enter_code_on_other')}</h2>
            <p className="text-brand-muted text-sm mt-1 mb-5">{t('open_safe_drop')}</p>
            
            <div className="w-full bg-brand-gray border-[1.5px] border-brand-dark py-5 px-6 rounded-2xl flex items-center justify-center shadow-inner mb-4">
              <span className="text-[44px] sm:text-[52px] leading-none font-display font-bold tracking-[0.25em] text-brand-dark select-all">{code}</span>
            </div>
            
            <button
              className="action-btn w-full py-3.5 px-6 rounded-2xl bg-brand-gray text-brand-dark font-bold flex items-center justify-center gap-2 border-[1.5px] border-brand-dark shadow-[0px_2px_0px_0px_#191A23] hover:bg-brand-lime"
              onClick={copyCode}
              type="button"
            >
              <span className="material-symbols-outlined text-[19px]">{isCopied ? 'check' : 'content_copy'}</span>
              <span>{isCopied ? t('copied') : t('copy_code')}</span>
            </button>
            
            <div className="w-full flex items-center my-6">
              <div className="flex-1 border-t border-brand-dark/20"></div>
              <span className="px-3 text-[11px] font-bold text-brand-muted uppercase tracking-wider">{t('or')}</span>
              <div className="flex-1 border-t border-brand-dark/20"></div>
            </div>
            
            <div className="w-full flex flex-col items-center">
              <div ref={qrRef} className="p-4 bg-white rounded-2xl border-[1.5px] border-brand-dark shadow-brutal-sm flex items-center justify-center">
              </div>
              <span className="text-[13px] text-brand-muted font-medium mt-4">{t('scan_qr')}</span>
            </div>
          </section>

          <div className="bg-white rounded-3xl p-5 border-[1.5px] border-brand-dark shadow-brutal-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[19px] text-brand-dark">schedule</span>
                <span className="text-[14px] font-semibold text-brand-dark">
                  <span>{t('room_expires')}</span>
                  <span className="tabular-nums font-bold ml-1">{`${m}:${s}`}</span>
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-brand-muted">
                <span className="w-2 h-2 rounded-full bg-emerald-500 status-pulse"></span>
                <span>{t('live_room')}</span>
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-brand-gray border border-brand-dark/20 overflow-hidden relative">
              <div className="absolute top-0 left-0 h-full rounded-full bg-brand-dark transition-all duration-1000 ease-linear" style={{width: `${progressPercent}%`}}></div>
            </div>
            <p className="text-[13px] text-brand-muted font-medium pt-0.5">{t('auto_delete_desc')}</p>
          </div>

          <div className="pt-2 flex flex-col items-center">
            <button
              className="action-btn w-full min-h-[48px] rounded-2xl border-[1.5px] border-brand-dark bg-white hover:bg-red-50 text-red-600 text-[15px] font-bold flex items-center justify-center gap-2 shadow-brutal-sm"
              onClick={handleCancel}
              type="button"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
              <span>{t('cancel')}</span>
            </button>
          </div>

        </div>
      </main>

      <footer className="w-full max-w-5xl mx-auto px-6 py-8 border-t border-brand-dark/10 mt-8">
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
