import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import {
  Plus,
  Search,
  LayoutGrid,
  Users,
  FileText,
  ArrowUpRight,
  MoreHorizontal,
  Clock3,
  LogOut,
  ArrowRight,
  Sparkles,
  PanelLeftClose,
} from "lucide-react";
import { Brand, initials } from "../components/Brand";
import { Modal } from "../components/Modal";
import { useAuth } from "../context/Auth";
import { api, errorMessage } from "../services/api";
import type { Document } from "../types";
export function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const shared = useLocation().pathname === "/shared";
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [create, setCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<Document | null>(null);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    api<Document[]>("/documents")
      .then(setDocs)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === "n" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !(
          event.target instanceof HTMLElement &&
          (event.target.matches("input, textarea, select") ||
            event.target.isContentEditable)
        )
      ) {
        event.preventDefault();
        setCreate(true);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  async function createDoc() {
    setBusy(true);
    try {
      const doc = await api<Document>("/documents", {
        method: "POST",
        body: JSON.stringify({ title: title.trim() || "Untitled document" }),
      });
      navigate(`/documents/${doc.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleteDoc) return;
    setBusy(true);
    try {
      await api(`/documents/${deleteDoc.id}`, { method: "DELETE" });
      setDocs(docs.filter((d) => d.id !== deleteDoc.id));
      setDeleteDoc(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const filtered = docs.filter(
    (d) =>
      (!shared || d.role !== "OWNER") &&
      d.title.toLowerCase().includes(search.toLowerCase()),
  );
  const owned = docs.filter((d) => d.role === "OWNER").length;
  return (
    <div className="workspace">
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
        <Brand />
        <div className="workspace-picker">
          <span className="workspace-initial">{initials(user!.name)[0]}</span>
          <span>
            Personal workspace<small>Free workspace</small>
          </span>
        </div>
        <button
          className="button primary new-doc"
          onClick={() => setCreate(true)}
        >
          <Plus size={17} /> New document <kbd>N</kbd>
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          <Link
            to="/"
            className={!shared ? "active" : ""}
            onClick={() => setMobile(false)}
          >
            <LayoutGrid size={18} /> All documents <span>{docs.length}</span>
          </Link>
          <Link
            to="/shared"
            className={shared ? "active" : ""}
            onClick={() => setMobile(false)}
          >
            <Users size={18} /> Shared with me{" "}
            <span>{docs.length - owned}</span>
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-icon">
              <Sparkles size={18} />
            </span>
            <strong>Ideas work better together.</strong>
            <p>
              Invite a teammate to a document
              <br />
              and make it a shared effort.
            </p>
          </div>
          <button
            className="profile-button"
            onClick={() => setMenu(menu === "profile" ? null : "profile")}
          >
            <span className="avatar">{initials(user!.name)}</span>
            <span>
              {user!.name}
              <small>Personal account</small>
            </span>
            <MoreHorizontal size={18} />
          </button>
          {menu === "profile" && (
            <button
              className="logout-menu"
              onClick={() =>
                void logout().catch((e) => setError(errorMessage(e)))
              }
            >
              <LogOut size={16} /> Sign out
            </button>
          )}
        </div>
      </aside>
      <main className="dashboard">
        <header className="dashboard-topbar">
          <div>
            <button
              className="icon-button mobile-nav"
              aria-label="Toggle navigation"
              onClick={() => setMobile(!mobile)}
            >
              <PanelLeftClose size={19} />
            </button>
            <span>Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{shared ? "Shared with me" : "All documents"}</strong>
          </div>
          <span className="topbar-note">
            <span className="status-dot" /> Your space for great work
          </span>
        </header>
        <div className="dashboard-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">YOUR WORK, ALL TOGETHER</span>
              <h1>
                {shared
                  ? "Shared with you"
                  : `Good to see you, ${user!.name.split(" ")[0]}.`}
              </h1>
              <p className="muted">
                {shared
                  ? "A shared space for a fresh perspective."
                  : "A fresh thought, a new chapter. What will you create today?"}
              </p>
            </div>
            <button className="button primary" onClick={() => setCreate(true)}>
              <Plus size={17} /> Create document
            </button>
          </div>
          {!shared && (
            <section className="welcome-banner">
              <div>
                <span className="banner-tag">
                  <span /> MADE FOR YOUR NEXT IDEA
                </span>
                <h2>
                  A blank page.
                  <br />A world of possibilities.
                </h2>
                <p>
                  Give your ideas a home. Write, share, and shape them together.
                </p>
                <button className="text-button" onClick={() => setCreate(true)}>
                  Start something new <ArrowRight size={16} />
                </button>
              </div>
              <div className="banner-art" aria-hidden="true">
                <div className="banner-paper back" />
                <div className="banner-paper front">
                  <span className="paper-spark">✦</span>
                  <div className="art-line long" />
                  <div className="art-line" />
                  <div className="art-line short" />
                  <div className="paper-check">✓</div>
                </div>
                <span className="floating-spark one">✧</span>
                <span className="floating-spark two">✦</span>
              </div>
            </section>
          )}
          <div className="documents-heading">
            <div>
              <h2>
                {shared ? "Shared documents" : "Your documents"}{" "}
                <span className="count">{filtered.length}</span>
              </h2>
              <p className="muted">
                {shared
                  ? "Keep moving, together."
                  : "Everything you’re working on, right here."}
              </p>
            </div>
            <label className="search-input">
              <Search size={17} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search documents…"
                aria-label="Search documents"
              />
            </label>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="document-tabs">
            <span className="selected">
              <FileText size={15} />{" "}
              {shared ? "Shared with me" : "All documents"}
            </span>
            <span className="sort-label">
              <Clock3 size={14} /> Last updated
            </span>
          </div>
          {loading ? (
            <div className="empty-state">Loading your workspace…</div>
          ) : filtered.length ? (
            <div className="document-grid">
              {filtered.map((doc, i) => (
                <article key={doc.id} className="document-card">
                  <Link
                    to={`/documents/${doc.id}`}
                    className={`document-cover cover-${i % 4}`}
                    aria-label={`Open ${doc.title}`}
                  >
                    <div className="cover-page">
                      <FileText size={23} strokeWidth={1.4} />
                      <span className="cover-title">{doc.title}</span>
                      <div className="art-line long" />
                      <div className="art-line" />
                      <div className="art-line short" />
                    </div>
                    <span className="open-document">
                      <ArrowUpRight size={19} />
                    </span>
                  </Link>
                  <div className="document-info">
                    <div className="document-info-title">
                      <Link to={`/documents/${doc.id}`}>{doc.title}</Link>
                      {doc.role === "OWNER" && (
                        <button
                          className="icon-button"
                          aria-label={`Actions for ${doc.title}`}
                          onClick={() =>
                            setMenu(menu === doc.id ? null : doc.id)
                          }
                        >
                          <MoreHorizontal size={18} />
                        </button>
                      )}
                      {menu === doc.id && (
                        <div className="card-menu">
                          <button
                            onClick={() => {
                              setDeleteDoc(doc);
                              setMenu(null);
                            }}
                          >
                            Delete document
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="document-meta">
                      <span>
                        {new Date(doc.updatedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <span className="role-badge">
                        {doc.role === "OWNER"
                          ? "Just you · owner"
                          : `${doc.owner?.name ?? "Shared"} · ${doc.role.toLowerCase()}`}
                      </span>
                    </div>
                  </div>
                </article>
              ))}
              <button className="create-card" onClick={() => setCreate(true)}>
                <span>
                  <Plus size={23} />
                </span>
                <strong>Create a new document</strong>
                <small>A little space for your next big idea</small>
              </button>
            </div>
          ) : (
            <div className="empty-state">
              <span className="empty-icon">
                <FileText size={28} />
              </span>
              <h3>
                {search
                  ? "No matching documents"
                  : shared
                    ? "Good ideas are on their way."
                    : "Your next idea starts here."}
              </h3>
              <p>
                {search
                  ? "Try a different search."
                  : shared
                    ? "Documents shared with your email will appear here."
                    : "Create your first document and make it your own."}
              </p>
              {!search && !shared && (
                <button
                  className="button primary"
                  onClick={() => setCreate(true)}
                >
                  <Plus size={16} /> Create your first document
                </button>
              )}
            </div>
          )}
          <footer className="dashboard-footer">
            <Brand small />
            <span>A little space for big ideas.</span>
          </footer>
        </div>
      </main>
      {create && (
        <Modal title="Start something new" onClose={() => setCreate(false)}>
          <p className="muted">Every good idea deserves a place to grow.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createDoc();
            }}
          >
            <label className="field-label">
              Document title
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Untitled document"
                maxLength={160}
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setCreate(false)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                Create document <ArrowRight size={16} />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {deleteDoc && (
        <Modal title="Delete this document?" onClose={() => setDeleteDoc(null)}>
          <p className="muted">
            “{deleteDoc.title}” and its version history will be permanently
            deleted for everyone.
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setDeleteDoc(null)}
            >
              Keep document
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              Delete document
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
