import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { getState, uploadFile, deleteFile, fileViewUrl, endSession, sendText } from '../js/api.js';
import { createWsManager } from '../js/ws.js';
import { compressImageFile } from '../js/compress.js';
import { t } from '../js/i18n.js';

export default function Room() {
  const navigate = useNavigate();
  const location = useLocation();

  const [code] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get('code');
    return (codeParam && /^\d{6}$/.test(codeParam)) ? codeParam : '';
  });
  const [files, setFiles] = useState([]);
  const [texts, setTexts] = useState([]);
  const [textInput, setTextInput] = useState('');
  const [expiresAt, setExpiresAt] = useState(null);
  const [timeLeft, setTimeLeft] = useState('--:--');
  const [isEnded, setIsEnded] = useState(false);
  const [toast, setToast] = useState({ msg: '', visible: false });
  const [viewer, setViewer] = useState({ isOpen: false, fileId: '', name: '', mime: '', url: '' });
  const [uploadingFiles, setUploadingFiles] = useState([]);

  const fileInputRef = useRef(null);
  const photoInputRef = useRef(null);
  // Keep ws ref for cleanup in the effect return
  const wsRef = useRef(null);

  const showToast = (msg) => {
    setToast({ msg, visible: true });
    setTimeout(() => setToast({ msg: '', visible: false }), 3000);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const codeParam = params.get('code');
    if (!codeParam || !/^\d{6}$/.test(codeParam)) {
      navigate('/');
      return;
    }

    if (!sessionStorage.getItem('sd_role')) {
      sessionStorage.setItem('sd_role', 'guest');
    }

    // Load initial state from the server
    getState(codeParam).then(({ ok, data }) => {
      if (!ok || data.status === 'ended') {
        setIsEnded(true);
        return;
      }
      if (data.expiresAt) setExpiresAt(data.expiresAt);
      if (data.files) setFiles(data.files);
      if (data.texts) setTexts(data.texts);
    }).catch(() => {
      // If we can't load state on mount, show as ended to avoid a broken room
      setIsEnded(true);
    });

    // WebSocket for live updates
    const ws = createWsManager();
    wsRef.current = ws;

    ws.connect(codeParam, {
      onMessage(msg) {
        if (msg.type === 'expires_at' && msg.expiresAt) setExpiresAt(msg.expiresAt);
        if (msg.type === 'file_added') {
          setFiles((prev) => {
            if (prev.find(f => f.id === msg.file.id)) return prev;
            return [...prev, msg.file];
          });
        }
        if (msg.type === 'text_added') {
          setTexts((prev) => {
            if (prev.find(t => t.id === msg.text.id)) return prev;
            return [...prev, msg.text];
          });
        }
        if (msg.type === 'file_removed') {
          setFiles((prev) => prev.filter(f => f.id !== msg.fileId));
        }
        if (msg.type === 'ended') {
          setIsEnded(true);
        }
        if (msg.type === 'peer_left') {
          showToast(t('peer_left'));
        }
      },
      onEnded() { setIsEnded(true); },
      onDisconnect() { showToast('Connection lost — trying to reconnect…'); },
    });

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [location.search, navigate]);

  // Countdown timer driven by expiresAt
  useEffect(() => {
    if (!expiresAt) return;
    const tick = setInterval(() => {
      const left = Math.max(0, expiresAt - Date.now());
      const m = Math.floor(left / 60000).toString().padStart(2, '0');
      const s = Math.floor((left % 60000) / 1000).toString().padStart(2, '0');
      setTimeLeft(`${m}:${s}`);
      if (left === 0) clearInterval(tick);
    }, 1000);
    return () => clearInterval(tick);
  }, [expiresAt]);

  const handleEndSession = async () => {
    if (!window.confirm(t('end_confirm'))) return;
    if (wsRef.current) wsRef.current.close();
    await endSession(code).catch(() => {});
    setIsEnded(true);
  };

  const fileIcon = (mime) => {
    if (mime === 'application/pdf') return 'picture_as_pdf';
    if (mime?.startsWith('image/')) return 'image';
    return 'description';
  };

  const formatSize = (bytes) => {
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const formatTime = (ts) => {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const handleFiles = async (fileList) => {
    const myRole = sessionStorage.getItem('sd_role') || 'host';

    await Promise.all(Array.from(fileList).map(async (rawFile) => {
      let file = rawFile;
      // Compress images client-side before upload
      try { file = await compressImageFile(rawFile); } catch { /* use original */ }

      const tempId = `upload-${Date.now()}-${Math.random()}`;
      setUploadingFiles((prev) => [...prev, { id: tempId, name: file.name, type: file.type }]);

      const result = await uploadFile(code, file).catch(() => ({ ok: false, status: 0 }));
      setUploadingFiles((prev) => prev.filter(f => f.id !== tempId));

      if (!result.ok) {
        let msg = 'Upload failed.';
        if (result.status === 415) msg = t('error_file_type');
        else if (result.status === 413) msg = t('error_file_size');
        showToast(msg);
      } else if (result.data?.id) {
        // Optimistically add file to list (WS will also push it, deduped by id)
        const newFile = {
          ...result.data,
          senderRole: myRole,
          createdAt: Date.now(),
        };
        setFiles((prev) => {
          if (prev.find(f => f.id === newFile.id)) return prev;
          return [...prev, newFile];
        });
      }
    }));
  };

  const handleSendText = async (e) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    const content = textInput.trim();
    setTextInput('');
    const myRole = sessionStorage.getItem('sd_role') || 'host';
    const res = await sendText(code, content).catch(() => ({ ok: false }));
    if (!res.ok) {
      showToast('Failed to send text.');
    } else if (res.data?.id) {
      const newText = {
        ...res.data,
        senderRole: myRole,
        createdAt: Date.now(),
      };
      setTexts(prev => {
        if (prev.find(t => t.id === newText.id)) return prev;
        return [...prev, newText];
      });
    }
  };

  const handleDeleteFile = async (fileId) => {
    if (!window.confirm('Remove this file from the room?')) return;
    await deleteFile(code, fileId).catch(() => {});
    // The WS file_removed event will update the list; remove optimistically too
    setFiles((prev) => prev.filter(f => f.id !== fileId));
  };

  const openViewer = (fileId, name, mime) => {
    const url = fileViewUrl(code, fileId);
    setViewer({ isOpen: true, fileId, name, mime, url });
  };

  const closeViewer = () => setViewer({ isOpen: false, fileId: '', name: '', mime: '', url: '' });

  const downloadFile = (fileId, name) => {
    const url = fileViewUrl(code, fileId);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // ── Ended state ─────────────────────────────────────────────────────────────

  if (isEnded) {
    return (
      <div style={{minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center', fontFamily: '"Plus Jakarta Sans", sans-serif', background: '#F4F6FA'}}>
        <div style={{width: '64px', height: '64px', borderRadius: '16px', background: '#F1F3F9', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem'}}>
          <span className="material-symbols-outlined" style={{fontSize: '36px', color: '#141722'}}>auto_delete</span>
        </div>
        <h1 style={{fontSize: '1.5rem', fontWeight: 800, color: '#141722', margin: 0}}>{t('room_ended')}</h1>
        <p style={{color: '#64748B', margin: '0.5rem 0 1.5rem', fontSize: '14px', maxWidth: '24rem'}}>{t('room_ended_desc')}</p>
        <button
          onClick={() => navigate('/')}
          style={{padding: '0.75rem 2rem', background: '#141722', color: '#fff', borderRadius: '9999px', fontWeight: 700, fontSize: '14px', border: 'none', cursor: 'pointer'}}
        >
          {t('start_new')}
        </button>
      </div>
    );
  }

  const myRole = sessionStorage.getItem('sd_role') || 'host';
  const allItems = [
    ...files.map(f => ({...f, _type: 'file'})),
    ...texts.map(t => ({...t, _type: 'text'}))
  ].sort((a, b) => a.createdAt - b.createdAt);

  // ── Room CSS (scoped inline to avoid conflicts with global styles) ───────────

  const CSS = `
    .room-body { font-family: 'Plus Jakarta Sans', sans-serif; background: #F4F6FA; color: #141722; }
    :root {
      --navy: #141722; --navy-hover: #242938;
      --bg: #F4F6FA; --card: #fff; --border: #E2E8F0;
      --muted: #64748B; --green-bg: #ECFDF5; --green: #059669;
      --green-dot: #10B981; --gray-bg: #F1F3F9; --gray-text: #475569;
      --btn-gray: #F0F2F7; --btn-gray-hover: #E4E7F0;
      --red: #DC2626; --red-bg: #FEF2F2;
    }
    .header-inner { height: 64px; max-width: 80rem; margin: 0 auto; padding: 0 1.5rem; display: flex; align-items: center; justify-content: space-between; }
    .logo-wrap { display: flex; align-items: center; gap: 0.75rem; }
    .logo-icon { width: 36px; height: 36px; border-radius: 12px; background: var(--navy); display: flex; align-items: center; justify-content: center; color: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
    .logo-text { font-size: 17px; font-weight: 800; letter-spacing: -0.02em; color: var(--navy); line-height: 1.2; }
    .logo-sub { font-size: 11px; color: var(--muted); font-weight: 500; }
    .connected-badge { display: flex; align-items: center; gap: 0.375rem; padding: 0.25rem 0.75rem; border-radius: 9999px; background: var(--green-bg); color: var(--green); font-size: 12px; font-weight: 700; }
    .connected-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green-dot); animation: pulse 2s infinite; }
    .room-badge { display: flex; align-items: center; gap: 0.375rem; padding: 0.25rem 0.75rem; border-radius: 8px; background: var(--gray-bg); border: 1px solid rgba(226,232,240,0.6); font-size: 12px; }
    .room-badge-label { color: var(--muted); font-weight: 500; }
    .room-badge-code { font-weight: 800; color: var(--navy); letter-spacing: 0.05em; }
    .timer-badge { display: flex; align-items: center; gap: 0.375rem; padding: 0.25rem 0.75rem; border-radius: 8px; background: var(--gray-bg); border: 1px solid rgba(226,232,240,0.6); font-size: 12px; color: var(--muted); font-weight: 500; }
    .timer-num { font-family: monospace; font-weight: 800; color: var(--navy); }
    .end-btn { display: flex; align-items: center; gap: 0.375rem; padding: 0.375rem 0.875rem; border-radius: 9999px; background: var(--red-bg); border: 1px solid #fecaca; color: var(--red); font-size: 12px; font-weight: 800; cursor: pointer; transition: background 0.15s; }
    .end-btn:hover { background: #fee2e2; }
    .main-inner { width: 100%; max-width: 48rem; margin: 0 auto; padding: 2rem 1rem; display: flex; flex-direction: column; gap: 1.25rem; }
    .card { background: var(--card); border: 1px solid rgba(226,232,240,0.8); border-radius: 20px; padding: 1.25rem; box-shadow: 0 4px 20px -2px rgba(20,23,34,0.05); }
    .privacy-banner { display: flex; align-items: flex-start; gap: 1rem; }
    .privacy-icon { width: 40px; height: 40px; border-radius: 12px; background: var(--gray-bg); color: var(--navy); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .e2ee-chip { display: flex; align-items: center; gap: 0.375rem; background: var(--green-bg); border: 1px solid rgba(167,243,208,0.6); color: var(--green); padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 12px; font-weight: 700; flex-shrink: 0; margin-left: auto; }
    .feed-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; padding: 0 0.25rem; }
    .feed-title { font-size: 15px; font-weight: 800; color: var(--navy); letter-spacing: -0.01em; }
    .feed-count { padding: 0.1rem 0.625rem; border-radius: 9999px; background: var(--gray-bg); color: var(--muted); font-size: 12px; font-weight: 700; margin-left: 0.5rem; }
    .live-label { font-size: 12px; font-weight: 700; color: var(--muted); display: flex; align-items: center; gap: 0.375rem; }
    .file-row { display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 0.75rem; }
    .file-icon-wrap { width: 48px; height: 48px; border-radius: 14px; background: var(--gray-bg); color: var(--navy); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .file-meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .file-who { font-size: 12px; color: var(--muted); font-weight: 500; }
    .file-who.me { color: var(--navy); font-weight: 700; }
    .file-name { font-size: 15px; font-weight: 800; color: var(--navy); letter-spacing: -0.01em; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; }
    .file-size { font-size: 12px; color: var(--muted); font-weight: 500; margin-top: 2px; }
    .view-btn { height: 40px; padding: 0 1.25rem; background: var(--btn-gray); color: var(--navy); font-weight: 800; font-size: 12px; border-radius: 9999px; display: flex; align-items: center; gap: 0.375rem; cursor: pointer; border: none; flex-shrink: 0; }
    .view-btn:hover { background: var(--btn-gray-hover); }
    .empty-state { text-align: center; padding: 3rem 1rem; color: var(--muted); }
    .dock-wrap { position: fixed; bottom: 1.5rem; left: 0; right: 0; z-index: 40; padding: 0 1rem; pointer-events: none; }
    .dock { max-width: 48rem; margin: 0 auto; background: rgba(255,255,255,0.95); backdrop-filter: blur(12px); border: 1px solid var(--border); border-radius: 28px; padding: 0.5rem; box-shadow: 0 12px 36px -4px rgba(20,23,34,0.12); display: flex; align-items: center; gap: 0.5rem; pointer-events: auto; }
    .text-input-form { display: flex; flex: 2; align-items: flex-end; gap: 0.5rem; background: #F1F3F9; border-radius: 20px; padding: 0.25rem 0.25rem 0.25rem 1rem; border: 1px solid transparent; min-width: 120px; transition: background 0.15s, border-color 0.15s; }
    .text-input-form:focus-within { background: #fff; border-color: var(--navy); }
    .text-input { flex: 1; border: none; background: transparent; font-family: monospace; font-size: 13px; outline: none; color: var(--navy); padding: 0.5rem 0; min-width: 50px; resize: none; max-height: 120px; line-height: 1.4; overflow-y: auto; }
    .send-text-btn { height: 36px; width: 36px; border-radius: 50%; background: var(--navy); color: #fff; display: flex; align-items: center; justify-content: center; border: none; cursor: pointer; flex-shrink: 0; opacity: 1; transition: opacity 0.15s; }
    .send-text-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .send-btn { flex: 1; height: 44px; padding: 0 1rem; background: var(--navy); color: #fff; font-weight: 800; font-size: 14px; border-radius: 9999px; display: flex; align-items: center; justify-content: center; gap: 0.375rem; cursor: pointer; border: none; white-space: nowrap; }
    .send-btn:hover { background: var(--navy-hover); }
    .photo-btn { height: 44px; padding: 0 1.25rem; background: #EDF0F7; color: var(--navy); font-weight: 800; font-size: 14px; border-radius: 9999px; display: flex; align-items: center; justify-content: center; gap: 0.375rem; cursor: pointer; border: none; flex-shrink: 0; }
    .photo-btn:hover { background: #dde2ef; }
    .room-toast { position: fixed; bottom: 6rem; left: 50%; transform: translateX(-50%); background: var(--navy); color: #fff; padding: 0.5rem 1.25rem; border-radius: 9999px; font-size: 13px; font-weight: 700; z-index: 200; pointer-events: none; }
    /* Modal */
    .view-overlay { position: fixed; inset: 0; z-index: 60; background: rgba(20,23,34,0.6); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; padding: 1rem; }
    .modal-box { background: #fff; width: 100%; max-width: 640px; border-radius: 24px; overflow: hidden; display: flex; flex-direction: column; border: 1px solid var(--border); box-shadow: 0 25px 60px rgba(20,23,34,0.2); max-height: 90vh; }
    .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); }
    .modal-body { padding: 1rem; min-height: 200px; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: auto; }
    .modal-footer { padding: 0.75rem 1.25rem; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; }
    .close-btn { width: 36px; height: 36px; border-radius: 50%; background: var(--gray-bg); border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--navy); }
    .close-btn:hover { background: #dde2ef; }
    .hide-on-mobile { display: none; }
    @media (min-width: 600px) { .hide-on-mobile { display: inline; } }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }
  `;

  return (
    <>
      <style>{CSS}</style>
      <div className="room-body" style={{minHeight: '100dvh', display: 'flex', flexDirection: 'column'}}>

        {toast.visible && <div className="room-toast">{toast.msg}</div>}

        <header style={{position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50, background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(226,232,240,0.8)'}}>
          <div className="header-inner">
            <div style={{display: 'flex', alignItems: 'center', gap: '1.5rem'}}>
              <div className="logo-wrap">
                <div className="logo-icon"><span className="material-symbols-outlined" style={{fontSize: '20px'}}>lock</span></div>
                <div>
                  <div className="logo-text">Safe-Drop</div>
                  <div className="logo-sub">Ephemeral Transfer Room</div>
                </div>
              </div>
              <div className="connected-badge"><span className="connected-dot"></span><span>Connected</span></div>
              <div className="room-badge">
                <span className="room-badge-label">Room</span>
                <span className="room-badge-code">{code || '––––––'}</span>
              </div>
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: '0.75rem'}}>
              <div className="timer-badge">
                <span className="material-symbols-outlined" style={{fontSize: '16px', color: 'var(--navy)'}}>timer</span>
                <span className="timer-num">{timeLeft}</span>
              </div>
              <button className="end-btn" onClick={handleEndSession} type="button">
                <span className="material-symbols-outlined" style={{fontSize: '16px'}}>power_settings_new</span>
                <span>End session</span>
              </button>
            </div>
          </div>
        </header>

        <main style={{flex: 1, overflowY: 'auto', paddingTop: '80px', paddingBottom: '7rem', display: 'flex', flexDirection: 'column'}}>
          <div className="main-inner">
            <div className="card">
              <div className="privacy-banner">
                <div className="privacy-icon"><span className="material-symbols-outlined" style={{fontSize: '22px'}}>visibility</span></div>
                <div style={{flex: 1, minWidth: 0}}>
                  <div style={{fontSize: '13px', fontWeight: 700, color: 'var(--navy)', marginBottom: '2px'}}>{t('ephemeral_title')}</div>
                  <div style={{fontSize: '12px', color: 'var(--muted)'}}>{t('ephemeral_desc')}</div>
                </div>
                <div className="e2ee-chip">
                  <span className="material-symbols-outlined" style={{fontSize: '14px', color: 'var(--green-dot)'}}>verified_user</span>
                  <span>{t('e2ee_active')}</span>
                </div>
              </div>
            </div>

            <div className="feed-header">
              <div style={{display: 'flex', alignItems: 'center'}}>
                <span className="feed-title">{t('shared_files') || 'Shared items'}</span>
                <span className="feed-count">{allItems.length} items</span>
              </div>
              <span className="live-label"><span className="connected-dot" style={{width: '8px', height: '8px', flexShrink: 0}}></span>{t('live_syncing')}</span>
            </div>

            <div style={{display: 'flex', flexDirection: 'column', gap: '1.25rem'}}>
              {allItems.length === 0 && uploadingFiles.length === 0 && (
                <div className="empty-state">
                  <div><span className="material-symbols-outlined" style={{fontSize: '48px'}}>upload_file</span></div>
                  <div style={{fontSize: '15px', fontWeight: 700, marginTop: '0.5rem'}}>No items yet</div>
                  <div style={{fontSize: '13px', marginTop: '0.25rem'}}>Send a file or text to get started.</div>
                </div>
              )}

              {allItems.map(item => {
                const isMe = item.senderRole === myRole;
                if (item._type === 'text') {
                  return (
                    <div key={item.id} className="card">
                      <div className="file-row">
                        <div className="file-icon-wrap" style={{background: 'var(--green-bg)', color: 'var(--green)'}}><span className="material-symbols-outlined" style={{fontSize: '26px'}}>notes</span></div>
                        <div className="file-meta">
                          <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap'}}>
                            <span className={`file-who${isMe ? ' me' : ''}`}>{isMe ? t('sent_by_you') : t('sent_by_other')}</span>
                            <span style={{color: 'var(--muted)', fontSize: '12px'}}>•</span>
                            <span style={{color: 'var(--muted)', fontSize: '12px'}}>{formatTime(item.createdAt)}</span>
                          </div>
                          <div className="file-name" style={{whiteSpace: 'pre-wrap', maxHeight: 'none', lineHeight: '1.5', marginTop: '6px', maxWidth: 'none', wordBreak: 'break-word', fontFamily: 'monospace', fontSize: '13px', background: '#F8FAFC', padding: '0.75rem', borderRadius: '12px', border: '1px solid #E2E8F0', overflowX: 'auto'}}>{item.content}</div>
                        </div>
                        <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0}}>
                          <button className="view-btn" onClick={() => navigator.clipboard.writeText(item.content).then(() => showToast('Copied!'))} type="button" style={{padding: '0 0.75rem'}} title="Copy text">
                            <span className="material-symbols-outlined" style={{fontSize: '17px'}}>content_copy</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }
                const file = item;
                return (
                  <div key={file.id} className="card">
                    <div className="file-row">
                      <div className="file-icon-wrap"><span className="material-symbols-outlined" style={{fontSize: '26px'}}>{fileIcon(file.mime)}</span></div>
                      <div className="file-meta">
                        <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap'}}>
                          <span className={`file-who${isMe ? ' me' : ''}`}>{isMe ? t('sent_by_you') : t('sent_by_other')}</span>
                          <span style={{color: 'var(--muted)', fontSize: '12px'}}>•</span>
                          <span style={{color: 'var(--muted)', fontSize: '12px'}}>{formatTime(file.createdAt)}</span>
                        </div>
                        <div className="file-name">{file.name}</div>
                        <div className="file-size">{formatSize(file.size)} • {file.mime === 'application/pdf' ? 'PDF' : 'Image'}</div>
                      </div>
                      <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0}}>
                        <button className="view-btn" onClick={() => openViewer(file.id, file.name, file.mime)} type="button">
                          <span className="material-symbols-outlined" style={{fontSize: '17px'}}>visibility</span>
                          <span>{t('view')}</span>
                        </button>
                        <button className="view-btn" onClick={() => downloadFile(file.id, file.name)} type="button" style={{padding: '0 0.75rem'}} title="Download">
                          <span className="material-symbols-outlined" style={{fontSize: '17px'}}>download</span>
                        </button>
                        {isMe && (
                          <button
                            onClick={() => handleDeleteFile(file.id)}
                            type="button"
                            title="Remove"
                            style={{padding: '0.5rem', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', borderRadius: '50%'}}
                          >
                            <span className="material-symbols-outlined" style={{fontSize: '18px'}}>delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {uploadingFiles.map(uFile => (
                <div key={uFile.id} className="card">
                  <div className="file-row">
                    <div className="file-icon-wrap"><span className="material-symbols-outlined" style={{fontSize: '26px'}}>{fileIcon(uFile.type)}</span></div>
                    <div className="file-meta">
                      <div className="file-who me">Sending…</div>
                      <div className="file-name">{uFile.name}</div>
                      <div style={{width: '100%', height: '6px', background: '#e5e7eb', borderRadius: '9999px', marginTop: '0.5rem', overflow: 'hidden', position: 'relative'}}>
                        <div style={{position: 'absolute', top: 0, left: 0, height: '100%', background: 'var(--navy)', borderRadius: '9999px', width: '50%', animation: 'slide 1.5s infinite linear'}}></div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>

        {/* Floating dock */}
        <aside className="dock-wrap">
          <div className="dock">
            <form className="text-input-form" onSubmit={handleSendText}>
              <textarea
                className="text-input"
                placeholder="Paste code or text..."
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                maxLength={5000}
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendText(e);
                  }
                }}
              />
              <button type="submit" className="send-text-btn" disabled={!textInput.trim()}>
                <span className="material-symbols-outlined" style={{fontSize: '18px', marginLeft: '2px'}}>send</span>
              </button>
            </form>

            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
              accept=".pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp,application/pdf"
              style={{display: 'none'}}
              multiple
            />
            <button className="send-btn" onClick={() => fileInputRef.current?.click()} type="button">
              <span className="material-symbols-outlined" style={{fontSize: '18px'}}>upload_file</span>
              <span className="hide-on-mobile">File</span>
            </button>

          </div>
        </aside>

        <footer style={{background: 'var(--card)', borderTop: '1px solid rgba(226,232,240,0.8)', padding: '0.75rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: 'var(--muted)'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
            <span className="material-symbols-outlined" style={{fontSize: '15px', color: 'var(--navy)'}}>lock</span>
            <span>Zero permanent storage • Peer-to-peer ephemeral handoff</span>
          </div>
          <Link to="/privacy" style={{color: 'var(--muted)', textDecoration: 'none', fontWeight: 600}}>Privacy &amp; Report abuse</Link>
        </footer>

        {/* File viewer modal */}
        {viewer.isOpen && (
          <div className="view-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeViewer(); }}>
            <div className="modal-box">
              <div className="modal-header">
                <div style={{display: 'flex', alignItems: 'center', gap: '0.75rem'}}>
                  <span className="material-symbols-outlined" style={{color: 'var(--navy)'}}>visibility</span>
                  <div>
                    <div style={{fontSize: '14px', fontWeight: 800, color: 'var(--navy)'}}>{viewer.name}</div>
                    <div style={{fontSize: '12px', color: 'var(--muted)'}}>{viewer.mime === 'application/pdf' ? 'PDF Document — Protected Preview' : 'Image — Protected Preview'}</div>
                  </div>
                </div>
                <button className="close-btn" onClick={closeViewer} type="button" aria-label="Close viewer">
                  <span className="material-symbols-outlined" style={{fontSize: '22px'}}>close</span>
                </button>
              </div>
              <div className="modal-body">
                {viewer.mime?.startsWith('image/') ? (
                  <img src={viewer.url} alt={viewer.name} style={{maxWidth: '100%', maxHeight: '60vh', display: 'block', margin: 'auto', objectFit: 'contain'}} />
                ) : viewer.mime === 'application/pdf' ? (
                  <iframe src={viewer.url} style={{width: '100%', height: '60vh', border: 'none'}} sandbox="allow-same-origin" title="PDF Viewer" />
                ) : (
                  <div style={{textAlign: 'center', padding: '2rem', color: 'var(--muted)'}}>Cannot preview this file type.</div>
                )}
              </div>
              <div className="modal-footer" style={{gap: '0.75rem'}}>
                <button onClick={() => downloadFile(viewer.fileId, viewer.name)} type="button" style={{padding: '0.5rem 1.25rem', background: '#F0F2F7', color: 'var(--navy)', borderRadius: '9999px', fontSize: '12px', fontWeight: 800, cursor: 'pointer', border: 'none', display: 'flex', alignItems: 'center', gap: '0.375rem'}}>
                  <span className="material-symbols-outlined" style={{fontSize: '16px'}}>download</span>
                  Download
                </button>
                <button onClick={closeViewer} type="button" style={{padding: '0.5rem 1.25rem', background: 'var(--navy)', color: '#fff', borderRadius: '9999px', fontSize: '12px', fontWeight: 800, cursor: 'pointer', border: 'none'}}>{t('close_viewer')}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
