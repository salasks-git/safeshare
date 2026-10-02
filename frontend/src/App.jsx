import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';

const Home = lazy(() => import('./components/Home'));
const Wait = lazy(() => import('./components/Wait'));
const Room = lazy(() => import('./components/Room'));
const Privacy = lazy(() => import('./components/Privacy'));

// Helper component to preserve query params during redirect
function RedirectWithQuery({ to }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}`} replace />;
}

function App() {
  return (
    <Router>
      <Suspense fallback={<div style={{height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif'}}>Loading...</div>}>
        <Routes>
          {/* Clean paths — no .html extensions. The SPA fallback in the Worker
              serves index.html for any unknown path, so reloading any of these
              routes works correctly. */}
          <Route path="/" element={<Home />} />
          <Route path="/wait" element={<Wait />} />
          <Route path="/room" element={<Room />} />
          <Route path="/privacy" element={<Privacy />} />
          
          {/* Legacy .html redirects (preserve query params like ?code=...) */}
          <Route path="/wait.html" element={<RedirectWithQuery to="/wait" />} />
          <Route path="/room.html" element={<RedirectWithQuery to="/room" />} />
          <Route path="/privacy.html" element={<RedirectWithQuery to="/privacy" />} />
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;
