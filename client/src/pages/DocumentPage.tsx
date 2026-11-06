import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Placeholder from "@tiptap/extension-placeholder";
import {
  ChevronLeft,
  ChevronRight,
  History,
  LockKeyhole,
  Share2,
  Check,
  WifiOff,
  FileText,
} from "lucide-react";
import { useAuth } from "../context/Auth";
import { api, errorMessage } from "../services/api";
import { useCollaboration, userColor } from "../hooks/useCollaboration";
import { Toolbar } from "../editor/Toolbar";
import { initials, Brand } from "../components/Brand";
import { ShareDialog } from "../components/ShareDialog";
import { VersionPanel } from "../components/VersionPanel";
import type { Document } from "../types";
export function DocumentPage() {
  const { id } = useParams();
  const [doc, setDoc] = useState<Document | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setDoc(null);
    setError("");
    api<Document>(`/documents/${id}`)
      .then(setDoc)
      .catch((e) => setError(errorMessage(e)));
  }, [id]);
  if (error)
    return (
      <div className="route-message">
        <h2>Unable to open document</h2>
        <p>{error}</p>
        <Link to="/">Back to workspace</Link>
      </div>
    );
  if (!doc) return <div className="route-message">Opening your document…</div>;
  return <DocumentWorkspace key={doc.id} document={doc} />;
}
function DocumentWorkspace({ document }: { document: Document }) {
  const { user } = useAuth();
  const viewer = document.role === "VIEWER";
  const collaboration = useCollaboration(document.id, user!, viewer);
  const [title, setTitle] = useState(document.title);
  const [savedTitle, setSavedTitle] = useState(document.title);
  const [error, setError] = useState("");
  const [share, setShare] = useState(false);
  const [history, setHistory] = useState(false);
  async function rename() {
    if (title === savedTitle) return;
    try {
      const d = await api<Document>(`/documents/${document.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      setSavedTitle(d.title);
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <div className="editor-layout">
      <header className="editor-header">
        <Link className="back-button" to="/" aria-label="Back to workspace">
          <ChevronLeft size={21} />
        </Link>
        <Link to="/" className="editor-brand">
          <Brand small />
        </Link>
        <ChevronRight size={15} className="muted" />
        <div className="editor-title-wrap">
          <input
            aria-label="Document title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void rename()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            maxLength={160}
            disabled={viewer || collaboration.blocked}
          />
          <span>
            <LockKeyhole size={10} />{" "}
            {document.role === "OWNER"
              ? "Personal workspace"
              : `Shared with you · ${document.role.toLowerCase()}`}
          </span>
        </div>
        <div className="editor-header-actions">
          <div className="collaborator-stack" aria-label="Online collaborators">
            {collaboration.people.slice(0, 5).map((p) => (
              <span
                key={p.clientId}
                className="avatar"
                style={{ background: `${p.color}20`, color: p.color }}
                title={p.name}
              >
                {initials(p.name)}
              </span>
            ))}
          </div>
          <button
            className={`button secondary history-button ${history ? "is-active" : ""}`}
            onClick={() => setHistory(!history)}
          >
            <History size={16} />
            <span>History</span>
          </button>
          {document.role === "OWNER" && (
            <button className="button primary" onClick={() => setShare(true)}>
              <Share2 size={15} /> Share
            </button>
          )}
        </div>
      </header>
      {error && (
        <div className="editor-alert error" role="alert">
          {error}
        </div>
      )}
      {collaboration.blocked && (
        <div className="editor-alert error" role="alert">
          Your session or editing permission changed. Your local edits are
          retained. Reopen the document to check access.
        </div>
      )}
      {collaboration.session ? (
        <LiveEditor
          title={title}
          viewer={viewer || collaboration.blocked}
          collaboration={collaboration}
          history={history}
          documentId={document.id}
          onCloseHistory={() => setHistory(false)}
        />
      ) : (
        <div className="route-message">Loading local document…</div>
      )}
      {share && (
        <ShareDialog id={document.id} onClose={() => setShare(false)} />
      )}
    </div>
  );
}
function LiveEditor({
  title,
  viewer,
  collaboration,
  history,
  documentId,
  onCloseHistory,
}: {
  title: string;
  viewer: boolean;
  collaboration: ReturnType<typeof useCollaboration>;
  history: boolean;
  documentId: string;
  onCloseHistory: () => void;
}) {
  const { user } = useAuth();
  const { session, status, pending, savedAt } = collaboration;
  const [words, setWords] = useState(0);
  const [, render] = useState(0);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        undoRedo: false,
        link: { openOnClick: false, protocols: ["http", "https"] },
      }),
      Collaboration.configure({ document: session!.doc }),
      CollaborationCaret.configure({
        provider: session!.provider,
        user: { name: user!.name, color: userColor(user!.id) },
      }),
      Placeholder.configure({
        placeholder: "Every great idea starts with a few words…",
      }),
    ],
    editable: !viewer,
    onUpdate: ({ editor }) =>
      setWords(editor.getText().trim().split(/\s+/).filter(Boolean).length),
    onTransaction: () => render((n) => n + 1),
    editorProps: {
      attributes: { "aria-label": "Document content", spellcheck: "true" },
    },
  });
  useEffect(() => {
    editor?.setEditable(!viewer);
  }, [viewer, editor]);
  useEffect(() => {
    if (editor)
      setWords(editor.getText().trim().split(/\s+/).filter(Boolean).length);
  }, [editor]);
  const online = status === "connected";
  return (
    <>
      <Toolbar editor={editor} disabled={viewer} />
      <div className="editor-body">
        <main className="editor-canvas">
          <div className="page-topline">
            <span>
              <FileText size={13} /> DOCUMENT
            </span>
            <span>
              {online ? (
                <>
                  <span className="status-dot" /> Live collaboration
                </>
              ) : (
                <>
                  <WifiOff size={13} />{" "}
                  {status === "connecting"
                    ? "Reconnecting…"
                    : "Offline · changes kept on this device"}
                </>
              )}
            </span>
          </div>
          <article className="document-paper">
            <h1 className="paper-document-title">
              {title || "Untitled document"}
            </h1>
            <EditorContent editor={editor} />
          </article>
          <div className="paper-bottom-note">
            A little space to let your thoughts unfold.
          </div>
        </main>
        {history && (
          <VersionPanel
            id={documentId}
            viewer={viewer}
            pending={!online || pending > 0}
            onClose={onCloseHistory}
          />
        )}
      </div>
      <footer className="editor-statusbar">
        <span>
          {online ? <span className="status-dot" /> : <WifiOff size={13} />}{" "}
          {online
            ? "Connected"
            : status === "connecting"
              ? "Connecting"
              : "Offline"}
          <span className="status-separator">·</span>
          {pending ? (
            online ? (
              "Saving changes…"
            ) : (
              "Changes retained locally"
            )
          ) : savedAt ? (
            <>
              <Check size={13} /> Saved at{" "}
              {savedAt.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </>
          ) : viewer ? (
            "View only"
          ) : (
            "Ready to write"
          )}
        </span>
        <span>
          {collaboration.people.length} online
          <span className="status-separator">·</span>
          {words} {words === 1 ? "word" : "words"}
          <span className="status-separator">·</span>100%
        </span>
      </footer>
    </>
  );
}
