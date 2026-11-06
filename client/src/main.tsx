import ReactDOM from "react-dom/client";
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/Auth";
import { AuthPage } from "./pages/AuthPage";
import { Dashboard } from "./pages/Dashboard";
const DocumentPage = lazy(() =>
  import("./pages/DocumentPage").then((m) => ({ default: m.DocumentPage })),
);
import "./styles.css";
function App() {
  const { user, loading, error, retry } = useAuth();
  if (loading) return <div className="route-message">Opening CollabSpace…</div>;
  if (error)
    return (
      <div className="route-message">
        <h2>Unable to reach your workspace</h2>
        <p>{error}</p>
        <button className="button primary" onClick={retry}>
          Try again
        </button>
      </div>
    );
  return (
    <Suspense
      fallback={<div className="route-message">Opening your document…</div>}
    >
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/register" element={<AuthPage register />} />
        <Route
          path="/"
          element={user ? <Dashboard /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/shared"
          element={user ? <Dashboard /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/documents/:id"
          element={user ? <DocumentPage /> : <Navigate to="/login" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>,
);
