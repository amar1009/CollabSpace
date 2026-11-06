import { useEffect, useState } from "react";
import { Check, Users, Trash2 } from "lucide-react";
import { api, errorMessage } from "../services/api";
import { Modal } from "./Modal";
import { initials } from "./Brand";
type Permission = {
  id: string;
  role: string;
  user: { id: string; name: string; email: string };
};
export function ShareDialog({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("EDITOR");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const load = () =>
    api<Permission[]>(`/documents/${id}/permissions`).then(setPermissions);
  useEffect(() => {
    void load().catch((e) => setError(errorMessage(e)));
  }, [id]);
  async function invite() {
    setBusy(true);
    setError("");
    try {
      await api(`/documents/${id}/permissions`, {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      await load();
      setEmail("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Better together" onClose={onClose}>
      <p className="muted">Invite a registered teammate to this document.</p>
      <form
        className="invite-form"
        onSubmit={(e) => {
          e.preventDefault();
          void invite();
        }}
      >
        <input
          aria-label="Teammate email"
          type="email"
          placeholder="Enter an email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <select
          aria-label="Permission"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="EDITOR">Can edit</option>
          <option value="VIEWER">Can view</option>
        </select>
        <button className="button primary" disabled={busy}>
          Invite
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <h3 className="small-heading">People with access</h3>
      <div className="permission-list">
        {permissions.map((p) => (
          <div className="permission" key={p.id}>
            <span className="avatar">{initials(p.user.name)}</span>
            <div>
              <strong>{p.user.name}</strong>
              <small>{p.user.email}</small>
            </div>
            <span>{p.role.toLowerCase()}</span>
            {p.role !== "OWNER" && (
              <button
                className="icon-button"
                aria-label={`Remove ${p.user.name}`}
                onClick={() => {
                  void api(`/documents/${id}/permissions/${p.user.id}`, {
                    method: "DELETE",
                  })
                    .then(load)
                    .catch((e) => setError(errorMessage(e)));
                }}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="share-footer">
        <span>
          <Users size={17} /> Only invited people can access
        </span>
        <button
          className="button secondary"
          onClick={() => {
            void navigator.clipboard
              .writeText(location.href)
              .then(() => setCopied(true))
              .catch((e) => setError(errorMessage(e)));
          }}
        >
          {copied && <Check size={14} />} {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </Modal>
  );
}
