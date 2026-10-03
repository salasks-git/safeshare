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

    getState(codeParam).then(({ ok, data }) => {
      if (!ok || data.status === 'ended') {
        setIsEnded(true);
        return;
      }
      if (data.expiresAt) setExpiresAt(data.expiresAt);
      if (data.files) setFiles(data.files);
      if (data.texts) setTexts(data.texts);
    }).catch(() => {
      setIsEnded(true);
    });

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

  useEffect(() => {
    if (!expiresAt) return;
    
    const updateTimer = () => {
      const left = Math.max(0, expiresAt - Date.now());
      const m = Math.floor(left / 60000).toString().padStart(2, '0');
      const s = Math.floor((left % 60000) / 1000).toString().padStart(2, '0');
      setTimeLeft(`${m}:${s}`);
      return left;
    };

    updateTimer();
    const tick = setInterval(() => {
      if (updateTimer() === 0) clearInterval(tick);
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
      try { file = await compressImageFile(rawFile); } catch { }

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
        const newFile = { ...result.data, senderRole: myRole, createdAt: Date.now() };
        setFiles((prev) => {
          if (prev.find(f => f.id === newFile.id)) return prev;
          return [...prev, newFile];
        });
      }
    }));
  };

  const handleSendText = async (e) => {
    if (e) e.preventDefault();
    if (!textInput.trim()) return;
    const content = textInput.trim();
    setTextInput('');
    const myRole = sessionStorage.getItem('sd_role') || 'host';
    const res = await sendText(code, content).catch(() => ({ ok: false }));
    if (!res.ok) {
      showToast('Failed to send text.');
    } else if (res.data?.id) {
      const newText = { ...res.data, senderRole: myRole, createdAt: Date.now() };
      setTexts(prev => {
        if (prev.find(t => t.id === newText.id)) return prev;
        return [...prev, newText];
      });
    }
  };

  const handleDeleteFile = async (fileId) => {
    if (!window.confirm('Remove this file from the room?')) return;
    await deleteFile(code, fileId).catch(() => {});
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
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  if (isEnded) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-[#FAFAFA] font-sans">
        <div className="w-16 h-16 rounded-2xl bg-brand-gray border-2 border-brand-dark flex items-center justify-center mb-4 shadow-brutal-sm">
          <span className="material-symbols-outlined text-[36px] text-brand-dark">auto_delete</span>
        </div>
        <h1 className="text-2xl font-display font-bold text-brand-dark">{t('room_ended')}</h1>
        <p className="text-brand-muted mt-2 mb-6 text-sm max-w-sm">{t('room_ended_desc')}</p>
        <button onClick={() => navigate('/')} className="bg-brand-dark text-white border-2 border-brand-dark px-8 py-3 rounded-full font-bold shadow-brutal-sm active:translate-y-0.5 hover:bg-black transition-all">
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

  const CSS = `
    @keyframes pulse-dot { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.4); opacity: 0.75; } }
    .status-pulse { animation: pulse-dot 2s infinite ease-in-out; }
    @keyframes orbit-float { 0%, 100% { transform: translateY(0px) rotate(0deg); } 50% { transform: translateY(-8px) rotate(1.5deg); } }
    .floating-illustration { animation: orbit-float 4s ease-in-out infinite; }
    
    .view-overlay { position: fixed; inset: 0; z-index: 60; background: rgba(25,26,35,0.6); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; padding: 1rem; }
    .modal-box { background: #fff; width: 100%; max-width: 640px; border-radius: 24px; overflow: hidden; display: flex; flex-direction: column; border: 2px solid #191A23; box-shadow: 0px 5px 0px 0px #191A23; max-height: 90vh; }
    .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.25rem; border-bottom: 2px solid #191A23; }
    .modal-body { padding: 1rem; min-height: 200px; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: auto; }
    .modal-footer { padding: 0.75rem 1.25rem; border-top: 2px solid #191A23; display: flex; justify-content: flex-end; }
    .close-btn { width: 36px; height: 36px; border-radius: 50%; background: #F3F3F3; border: 2px solid #191A23; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #191A23; box-shadow: 0px 3px 0px 0px #191A23; transition: all 0.15s; }
    .close-btn:active { transform: translateY(2px); box-shadow: 0px 1px 0px 0px #191A23; }
    .room-toast { position: fixed; bottom: 6rem; left: 50%; transform: translateX(-50%); background: #191A23; color: #fff; padding: 0.5rem 1.25rem; border-radius: 9999px; font-size: 13px; font-weight: 700; z-index: 200; pointer-events: none; border: 2px solid #191A23; }
  `;

  return (
    <>
      <style>{CSS}</style>
      <div className="min-h-screen flex flex-col justify-between bg-[#FAFAFA] text-brand-dark antialiased">
        {toast.visible && <div className="room-toast">{toast.msg}</div>}

        <header className="w-full border-b border-brand-dark/10 bg-white sticky top-0 z-40">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-11 h-11 bg-brand-dark rounded-xl flex items-center justify-center text-white border-2 border-brand-dark shadow-brutal-sm transition-transform hover:-translate-y-0.5">
                <svg className="w-5 h-5 text-brand-lime" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24">
                  <rect height="11" rx="2" ry="2" width="18" x="3" y="11"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h1 className="font-display font-bold text-xl tracking-tight leading-none text-brand-dark">Safe-Drop</h1>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#E9FFCC] text-brand-dark border border-brand-dark/30">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 mr-1.5 status-pulse"></span>
                    Connected
                  </span>
                </div>
                <p className="text-xs font-medium text-brand-muted mt-0.5">Ephemeral Transfer Room</p>
              </div>
              <div className="hidden md:flex items-center bg-brand-gray border border-brand-dark/20 rounded-full px-3.5 py-1 text-xs font-semibold text-brand-dark space-x-1.5 ml-2">
                <span className="text-brand-muted font-normal">Room</span>
                <span className="font-display font-bold tracking-wider text-brand-dark">{code || '––––––'}</span>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="flex items-center bg-white border-2 border-brand-dark rounded-full px-3.5 py-1.5 shadow-brutal-sm space-x-2">
                <svg className="w-4 h-4 text-brand-dark stroke-[2.2]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                <span className="font-display font-bold text-sm tracking-wider text-brand-dark">{timeLeft}</span>
              </div>
              <button onClick={handleEndSession} className="group flex items-center space-x-2 bg-white hover:bg-red-50 text-red-600 border-2 border-brand-dark rounded-full px-4 py-1.5 font-bold text-sm shadow-brutal-sm hover:shadow-[0_2px_0px_0px_#191A23] active:translate-y-0.5 transition-all" type="button">
                <svg className="w-4 h-4 stroke-[2.5] text-red-500 group-hover:rotate-90 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
                  <line x1="12" x2="12" y1="2" y2="12"></line>
                </svg>
                <span className="hidden sm:inline">End session</span>
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col justify-start space-y-7">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center space-x-3">
              <div className="inline-block relative">
                <span className="bg-brand-lime px-3 py-1 rounded-lg border-2 border-brand-dark font-display font-bold text-xl text-brand-dark inline-block shadow-brutal-sm">
                  Shared Items
                </span>
              </div>
              <span className="text-xs font-bold font-display px-2.5 py-1 bg-white border border-brand-dark/30 text-brand-dark rounded-full">
                {allItems.length} items
              </span>
            </div>
            <div className="flex items-center space-x-2 text-xs font-bold text-brand-dark">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span className="tracking-wide">Live syncing</span>
            </div>
          </div>

          {allItems.length === 0 && uploadingFiles.length === 0 && (
            <section className="w-full flex-1 min-h-[380px] bg-white border-2 border-dashed border-brand-dark/30 rounded-3xl p-8 flex flex-col items-center justify-center text-center relative overflow-hidden transition-all hover:border-brand-dark/50" data-purpose="empty-state">
              <div className="floating-illustration relative mb-6">
                <div className="w-32 h-20 border-2 border-brand-dark/20 rounded-full absolute -top-4 -left-6 rotate-[-12deg] pointer-events-none"></div>
                <div className="w-36 h-24 border-2 border-brand-dark/15 rounded-full absolute -top-6 -left-8 rotate-[-6deg] pointer-events-none"></div>
                <div className="relative z-10 w-24 h-24 bg-brand-gray border-2 border-brand-dark rounded-3xl flex items-center justify-center shadow-brutal transition-transform">
                  <div className="absolute -top-3 -right-3 w-7 h-7 bg-brand-lime border-2 border-brand-dark rounded-md flex items-center justify-center rotate-12 shadow-brutal-sm">
                    <svg className="w-4 h-4 text-brand-dark fill-current" viewBox="0 0 24 24">
                      <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z"></path>
                    </svg>
                  </div>
                  <svg className="w-11 h-11 text-brand-dark stroke-[1.8]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <path d="M12 18v-6"></path>
                    <path d="m9 15 3-3 3 3"></path>
                  </svg>
                </div>
              </div>
              <h3 className="font-display font-bold text-2xl text-brand-dark mb-2 tracking-tight">No items yet</h3>
              <p className="text-brand-muted font-medium text-sm max-w-sm">
                Send a file or text to get started.
              </p>
            </section>
          )}

          <div className="flex flex-col gap-5 pb-24">
            {allItems.map(item => {
              const isMe = item.senderRole === myRole;
              if (item._type === 'text') {
                return (
                  <div key={item.id} className="bg-white border-2 border-brand-dark rounded-2xl p-4 sm:p-5 shadow-brutal-sm">
                    <div className="flex items-start sm:items-center justify-between gap-3 sm:gap-4 flex-col sm:flex-row">
                      <div className="flex w-full sm:w-auto items-center gap-3 sm:gap-4 flex-1 min-w-0">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-brand-lime border-2 border-brand-dark flex items-center justify-center text-brand-dark shrink-0">
                          <span className="material-symbols-outlined text-[20px] sm:text-[24px]">notes</span>
                        </div>
                        <div className="flex flex-col flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1.5">
                            <span className={`text-xs font-bold ${isMe ? 'text-brand-dark' : 'text-brand-muted'}`}>{isMe ? t('sent_by_you') : t('sent_by_other')}</span>
                            <span className="text-brand-muted text-[10px]">•</span>
                            <span className="text-brand-muted text-xs font-medium">{formatTime(item.createdAt)}</span>
                          </div>
                          <div className="font-mono text-sm bg-brand-gray border-2 border-brand-dark/20 p-3 rounded-xl overflow-x-auto whitespace-pre-wrap word-break">{item.content}</div>
                        </div>
                      </div>
                      <div className="flex items-center shrink-0 w-full sm:w-auto justify-end mt-2 sm:mt-0">
                        <button onClick={() => navigator.clipboard.writeText(item.content).then(()=>showToast('Copied!'))} className="w-10 h-10 rounded-full bg-brand-gray border-2 border-brand-dark flex items-center justify-center text-brand-dark hover:bg-brand-lime transition-colors shadow-[0px_2px_0px_0px_#191A23] active:translate-y-0.5" title="Copy text">
                          <span className="material-symbols-outlined text-[18px]">content_copy</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }
              const file = item;
              return (
                <div key={file.id} className="bg-white border-2 border-brand-dark rounded-2xl p-4 sm:p-5 shadow-brutal-sm">
                  <div className="flex items-start sm:items-center justify-between gap-3 sm:gap-4 flex-col sm:flex-row">
                    <div className="flex w-full sm:w-auto items-center gap-3 sm:gap-4 flex-1 min-w-0">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-brand-gray border-2 border-brand-dark flex items-center justify-center text-brand-dark shrink-0">
                        <span className="material-symbols-outlined text-[20px] sm:text-[24px]">{fileIcon(file.mime)}</span>
                      </div>
                      <div className="flex flex-col flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`text-xs font-bold ${isMe ? 'text-brand-dark' : 'text-brand-muted'}`}>{isMe ? t('sent_by_you') : t('sent_by_other')}</span>
                          <span className="text-brand-muted text-[10px]">•</span>
                          <span className="text-brand-muted text-xs font-medium">{formatTime(file.createdAt)}</span>
                        </div>
                        <div className="text-sm font-bold text-brand-dark truncate">{file.name}</div>
                        <div className="text-xs font-medium text-brand-muted mt-0.5">{formatSize(file.size)} • {file.mime === 'application/pdf' ? 'PDF' : 'Image'}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end mt-2 sm:mt-0">
                      <button onClick={() => openViewer(file.id, file.name, file.mime)} className="h-10 px-4 rounded-full bg-brand-gray border-2 border-brand-dark flex items-center justify-center gap-2 text-brand-dark hover:bg-brand-lime transition-colors shadow-[0px_2px_0px_0px_#191A23] active:translate-y-0.5">
                        <span className="material-symbols-outlined text-[18px]">visibility</span>
                        <span className="text-xs font-bold">{t('view')}</span>
                      </button>
                      <button onClick={() => downloadFile(file.id, file.name)} className="w-10 h-10 rounded-full bg-brand-gray border-2 border-brand-dark flex items-center justify-center text-brand-dark hover:bg-brand-lime transition-colors shadow-[0px_2px_0px_0px_#191A23] active:translate-y-0.5" title="Download">
                        <span className="material-symbols-outlined text-[18px]">download</span>
                      </button>
                      {isMe && (
                        <button onClick={() => handleDeleteFile(file.id)} className="w-10 h-10 rounded-full bg-red-50 border-2 border-red-200 flex items-center justify-center text-red-500 hover:bg-red-100 transition-colors shadow-[0px_2px_0px_0px_#191A23] active:translate-y-0.5" title="Remove">
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {uploadingFiles.map(uFile => (
              <div key={uFile.id} className="bg-white border-2 border-brand-dark rounded-2xl p-4 sm:p-5 shadow-brutal-sm opacity-60">
                <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-brand-gray border-2 border-brand-dark flex items-center justify-center text-brand-dark shrink-0">
                    <span className="material-symbols-outlined text-[20px] sm:text-[24px]">{fileIcon(uFile.type)}</span>
                  </div>
                  <div className="flex flex-col flex-1 min-w-0">
                    <div className="text-xs font-bold text-brand-dark mb-1">Sending…</div>
                    <div className="text-sm font-bold text-brand-dark truncate">{uFile.name}</div>
                    <div className="w-full h-1.5 bg-brand-gray border border-brand-dark/20 rounded-full mt-1.5 overflow-hidden relative">
                      <div className="absolute top-0 left-0 h-full bg-brand-dark rounded-full w-1/2" style={{animation: 'slide 1.5s infinite linear'}}></div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </main>

        <aside className="fixed bottom-6 w-full z-30 px-4">
          <div className="max-w-3xl mx-auto bg-white border-2 border-brand-dark rounded-full p-2 pl-4 sm:pl-5 shadow-brutal flex items-center justify-between gap-3 backdrop-blur-md">
            <form onSubmit={handleSendText} className="flex-1 flex items-center space-x-2">
              <textarea
                className="w-full bg-transparent border-0 focus:ring-0 text-brand-dark placeholder-brand-muted text-sm sm:text-base font-mono outline-none py-1.5 px-0 resize-none"
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
              <button type="submit" disabled={!textInput.trim()} className="w-10 h-10 rounded-full bg-brand-gray border-2 border-brand-dark flex items-center justify-center text-brand-dark hover:bg-brand-lime transition-colors shrink-0 shadow-[0px_2px_0px_0px_#191A23] active:translate-y-0.5 disabled:opacity-50">
                <svg className="w-4 h-4 -rotate-45 ml-0.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24">
                  <line x1="22" x2="11" y1="2" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </button>
            </form>
            <div className="h-8 w-[2px] bg-brand-dark/15 hidden sm:block"></div>
            <input type="file" ref={fileInputRef} onChange={(e) => { if(e.target.files) handleFiles(e.target.files); e.target.value = ''; }} accept=".pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp,application/pdf" style={{display:'none'}} multiple />
            <button onClick={() => fileInputRef.current?.click()} className="bg-brand-dark hover:bg-black text-white rounded-full px-6 py-2.5 flex items-center space-x-2 font-display font-bold text-sm tracking-wide border-2 border-brand-dark shadow-brutal-sm active:translate-y-0.5 transition-all shrink-0 group">
              <svg className="w-4 h-4 text-brand-lime group-hover:scale-110 transition-transform stroke-[2.2]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="12" x2="12" y1="18" y2="12"></line>
                <line x1="9" x2="15" y1="15" y2="15"></line>
              </svg>
              <span className="hidden sm:inline">File</span>
            </button>
          </div>
        </aside>

        <footer className="w-full border-t border-brand-dark/10 py-5 bg-white text-xs text-brand-muted mt-auto mb-[72px]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
            <div className="flex items-center space-x-2 font-medium">
              <svg className="w-3.5 h-3.5 text-brand-dark stroke-[2.2]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect height="11" rx="2" ry="2" width="18" x="3" y="11"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
              <span>Zero permanent storage • Peer-to-peer ephemeral handoff</span>
            </div>
            <div className="font-medium">
              <Link to="/privacy" className="hover:text-brand-dark underline underline-offset-4 decoration-brand-dark/30 hover:decoration-brand-dark transition-colors">
                Privacy &amp; Report abuse
              </Link>
            </div>
          </div>
        </footer>

        {viewer.isOpen && (
          <div className="view-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeViewer(); }}>
            <div className="modal-box">
              <div className="modal-header">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-brand-dark">visibility</span>
                  <div>
                    <div className="text-sm font-bold text-brand-dark">{viewer.name}</div>
                    <div className="text-xs text-brand-muted">{viewer.mime === 'application/pdf' ? 'PDF Document — Protected Preview' : 'Image — Protected Preview'}</div>
                  </div>
                </div>
                <button className="close-btn" onClick={closeViewer} type="button" aria-label="Close viewer">
                  <span className="material-symbols-outlined text-[22px]">close</span>
                </button>
              </div>
              <div className="modal-body">
                {viewer.mime?.startsWith('image/') ? (
                  <img src={viewer.url} alt={viewer.name} className="max-w-full max-h-[60vh] object-contain block mx-auto" />
                ) : viewer.mime === 'application/pdf' ? (
                  <iframe src={viewer.url} className="w-full h-[60vh] border-none" sandbox="allow-same-origin" title="PDF Viewer" />
                ) : (
                  <div className="text-center p-8 text-brand-muted">Cannot preview this file type.</div>
                )}
              </div>
              <div className="modal-footer gap-3">
                <button onClick={() => downloadFile(viewer.fileId, viewer.name)} type="button" className="px-5 py-2 bg-brand-gray text-brand-dark border-2 border-brand-dark rounded-full text-xs font-bold shadow-brutal-sm active:translate-y-0.5 flex items-center gap-1.5 hover:bg-brand-lime transition-colors">
                  <span className="material-symbols-outlined text-[16px]">download</span>
                  Download
                </button>
                <button onClick={closeViewer} type="button" className="px-5 py-2 bg-brand-dark text-white border-2 border-brand-dark rounded-full text-xs font-bold shadow-brutal-sm active:translate-y-0.5 hover:bg-black transition-all">
                  {t('close_viewer')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
