import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { History, X, GitBranch, Plus } from "lucide-react";
import { api, errorMessage } from "../services/api";
import type { Version } from "../types";
export function VersionPanel({
  id,
  viewer,
  pending,
  onClose,
}: {
  id: string;
  viewer: boolean;
  pending: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [versions, setVersions] = useState<Version[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = useEditor({
    extensions: [StarterKit],
    editable: false,
    content: "",
  });
  const load = () =>
    api<Version[]>(`/documents/${id}/versions`).then(setVersions);
  useEffect(() => {
    void load().catch((e) => setError(errorMessage(e)));
  }, [id]);
  async function view(versionId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/documents/${id}/versions/${versionId}`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Unable to load this version.");
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, new Uint8Array(await response.arrayBuffer()));
        preview?.commands.setContent(
          yXmlFragmentToProsemirrorJSON(doc.getXmlFragment("default")),
        );
        setSelected(versionId);
      } finally {
        doc.destroy();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      await api(`/documents/${id}/versions`, { method: "POST" });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    setBusy(true);
    try {
      const doc = await api<{ id: string }>(
        `/documents/${id}/versions/${selected}/restore`,
        { method: "POST" },
      );
      navigate(`/documents/${doc.id}`);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="version-panel">
      <div className="panel-heading">
        <h2>
          <History size={18} /> Version history
        </h2>
        <button
          className="icon-button"
          aria-label="Close history"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <p className="muted">
        A little look back at how far you’ve come. Snapshots are saved every
        minute while open.
      </p>
      {!viewer && (
        <button
          className="button secondary"
          disabled={busy || pending}
          onClick={() => void save()}
        >
          <Plus size={15} /> Save a version now
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="version-list">
        {!versions.length && (
          <p className="muted">
            No snapshots yet. Your first one is on its way.
          </p>
        )}
        {versions.map((v, i) => (
          <button
            data-testid={`version-${v.id}`}
            className={selected === v.id ? "selected" : ""}
            key={v.id}
            onClick={() => void view(v.id)}
            disabled={busy}
          >
            <span className="timeline-dot" />
            <div>
              <strong>{new Date(v.createdAt).toLocaleString()}</strong>
              <small>
                {i === 0 ? "Latest saved version" : "Previous version"}
              </small>
            </div>
          </button>
        ))}
      </div>
      {selected && (
        <>
          <span className="eyebrow">VERSION PREVIEW</span>
          <div className="version-preview">
            <EditorContent editor={preview} />
          </div>
          {!viewer && (
            <>
              <p className="restore-note">
                <GitBranch size={17} /> Restore creates a separate document.
                Current work and collaborators stay here.
              </p>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void restore()}
              >
                Restore as a new document
              </button>
            </>
          )}
        </>
      )}
    </aside>
  );
}
