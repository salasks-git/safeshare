import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { endSession } from '../js/api.js';
import { createWsManager } from '../js/ws.js';
import { generateQR } from '../js/qr.js';
import { t, getLang, setLang } from '../js/i18n.js';

const TOTAL = 300; // 5-minute wait timeout in seconds

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

    // Render QR code into the ref element
    if (qrRef.current) {
      const qrUrl = `${window.location.origin}/?code=${codeParam}`;
      qrRef.current.innerHTML = '';
      generateQR(qrUrl, qrRef.current);
    }

    // Countdown timer
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

    // WebSocket — listen for peer_joined
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
      onDisconnect() {
        // Silent; the WS manager already retried 3 times
      },
    });

    return () => {
      clearInterval(tick);
      ws.close();
    };
  }, [location.search, navigate]); // location.search is stable; avoid re-runs

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
      <div style={{minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center', fontFamily: 'Inter, sans-serif', background: '#faf8ff'}}>
        <div style={{width: '64px', height: '64px', borderRadius: '16px', background: '#F0F2F7', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem'}}>
          <span className="material-symbols-outlined" style={{fontSize: '32px', color: '#141722'}}>schedule</span>
        </div>
        <h1 style={{fontSize: '1.5rem', fontWeight: 700, color: '#141722', margin: 0}}>Room Expired</h1>
        <p style={{color: '#6b7280', margin: '0.5rem 0 1.5rem', fontSize: '0.9rem'}}>No one joined in time. All data was wiped.</p>
        <button
          onClick={() => navigate('/')}
          style={{padding: '0.75rem 2rem', background: '#141722', color: '#fff', borderRadius: '9999px', fontWeight: 600, fontSize: '0.9rem', border: 'none', cursor: 'pointer'}}
        >
          {t('start_new')}
        </button>
      </div>
    );
  }

  const m = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
  const s = (secondsLeft % 60).toString().padStart(2, '0');
  const progressPercent = (secondsLeft / TOTAL) * 100;

  return (
    <>
      <header className="fixed top-0 w-full z-50 pt-safe bg-surface/85 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.03)]">
        <div className="h-16 max-w-xl mx-auto px-margin-mobile flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-[#141722] flex items-center justify-center text-white shadow-sm">
              <span className="material-symbols-outlined text-[18px]">lock</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[17px] font-semibold text-on-surface leading-none tracking-tight">Safe-Drop</span>
              <span className="text-[11px] text-on-surface-variant mt-0.5">Encrypted P2P Room</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 h-11 px-3 rounded-lg bg-[#f2f3ff] text-on-surface-variant focus-within:ring-2 focus-within:ring-primary">
            <span className="material-symbols-outlined text-[18px] text-primary">translate</span>
            <select
              value={lang}
              onChange={handleLangChange}
              className="bg-transparent text-[13px] font-medium text-on-surface focus:outline-none pr-1 appearance-none cursor-pointer"
              id="lang-select"
            >
              <option value="en">English</option>
              <option value="ml">മലയാളം</option>
              <option value="hi">हिन्दी</option>
            </select>
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant pointer-events-none">expand_more</span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-start w-full pt-20 pb-20 bg-surface px-margin-mobile">
        <div className="flex flex-col w-full max-w-xl mx-auto space-y-space-md py-space-sm">
          <div className="flex items-center justify-center">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#DCFCE7] text-[#15803D] border border-[#BBF7D0] shadow-sm">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10B981] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#10B981]"></span>
              </span>
              <span className="text-[13px] font-medium text-[#15803D]">{t('waiting_for_peer')}</span>
            </div>
          </div>

          <div className="bg-white rounded-[28px] p-space-lg shadow-[0_4px_24px_rgba(0,0,0,0.04)] border border-outline-variant/20 flex flex-col items-center text-center">
            <h2 className="text-[15px] font-semibold text-[#141722]">{t('enter_code_on_other')}</h2>
            <p className="text-[13px] text-on-surface-variant mt-1 mb-space-md">{t('open_safe_drop')}</p>
            <div className="w-full bg-[#F2F4F9] py-5 px-6 rounded-2xl flex items-center justify-center border border-outline-variant/20 shadow-inner">
              <span className="text-[52px] leading-none font-bold tracking-[0.25em] text-[#141722] select-all tabular-nums">{code}</span>
            </div>
            <button
              className="w-full mt-space-md min-h-[46px] px-space-md rounded-full bg-[#F0F2F7] hover:bg-[#E5E8F0] active:bg-[#E5E8F0] text-[#141722] text-[14px] font-semibold flex items-center justify-center gap-2 transition-colors duration-150"
              onClick={copyCode}
              type="button"
            >
              <span className="material-symbols-outlined text-[19px] text-[#141722]">{isCopied ? 'check' : 'content_copy'}</span>
              <span>{isCopied ? t('copied') : t('copy_code')}</span>
            </button>
            <div className="w-full flex items-center my-space-lg">
              <div className="flex-1 border-t border-outline-variant/30"></div>
              <span className="px-3 text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">{t('or')}</span>
              <div className="flex-1 border-t border-outline-variant/30"></div>
            </div>
            <div className="w-full flex flex-col items-center">
              <div ref={qrRef} className="p-3.5 bg-white rounded-2xl border border-outline-variant/30 shadow-[0_2px_12px_rgba(0,0,0,0.04)] flex items-center justify-center">
              </div>
              <span className="text-[12px] text-on-surface-variant font-medium mt-3">{t('scan_qr')}</span>
            </div>
          </div>

          <div className="bg-white rounded-[24px] p-space-md border border-outline-variant/20 shadow-[0_4px_24px_rgba(0,0,0,0.03)] space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[19px] text-[#141722]">schedule</span>
                <span className="text-[14px] font-semibold text-on-surface">
                  <span>{t('room_expires')}</span>
                  <span className="tabular-nums text-[#141722] font-bold ml-1">{`${m}:${s}`}</span>
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-on-surface-variant">
                <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse"></span>
                <span>{t('live_room')}</span>
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-[#E5E7EB] overflow-hidden">
              <div className="h-full rounded-full bg-[#141722] transition-all duration-1000 ease-linear" style={{width: `${progressPercent}%`}}></div>
            </div>
            <p className="text-[13px] text-on-surface-variant leading-relaxed pt-0.5">{t('auto_delete_desc')}</p>
          </div>

          <div className="pt-space-xs flex flex-col items-center">
            <button
              className="w-full min-h-[48px] rounded-full border border-outline-variant/40 hover:border-red-300 hover:bg-red-50 active:bg-red-100 text-[#DC2626] text-[15px] font-semibold flex items-center justify-center gap-2 transition-colors duration-150"
              onClick={handleCancel}
              type="button"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
              <span>{t('cancel')}</span>
            </button>
          </div>
        </div>
      </main>

      <footer className="fixed bottom-0 w-full z-40 pb-safe bg-surface/90 backdrop-blur-md shadow-[0_-1px_6px_rgba(0,0,0,0.02)]">
        <div className="h-12 max-w-xl mx-auto px-margin-mobile flex items-center justify-between text-on-surface-variant text-[12px]">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-primary">verified_user</span>
            <span>{t('end_to_end')}</span>
          </div>
          <div className="flex items-center gap-3">
            <Link className="hover:underline" to="/privacy">{t('privacy')}</Link>
            <span className="w-1 h-1 rounded-full bg-outline-variant"></span>
            <a className="hover:underline" href="mailto:abuse@example.com?subject=Safe-Drop+Abuse+Report">{t('report_abuse')}</a>
          </div>
        </div>
      </footer>
    </>
  );
}
