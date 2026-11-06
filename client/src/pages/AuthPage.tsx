import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowRight, Check, Quote } from "lucide-react";
import { Brand } from "../components/Brand";
import { useAuth } from "../context/Auth";
import { api, errorMessage } from "../services/api";
import type { User } from "../types";
export function AuthPage({ register = false }: { register?: boolean }) {
  const { user, setUser } = useAuth();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      setUser(
        await api<User>(`/auth/${register ? "register" : "login"}`, {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(form)),
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-main">
        <Brand />
        <div className="auth-form-wrap">
          <span className="eyebrow">A SPACE TO THINK TOGETHER</span>
          <h1>{register ? "Make room for your ideas." : "Welcome back."}</h1>
          <p className="muted">
            {register
              ? "Your best work starts with a shared space."
              : "Pick up where your ideas left off."}
          </p>
          <form onSubmit={submit} className="auth-form">
            {register && (
              <label>
                Full name
                <input
                  name="name"
                  placeholder="Alex Morgan"
                  required
                  maxLength={80}
                  autoComplete="name"
                />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                name="email"
                placeholder="you@company.com"
                required
                autoComplete="email"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                placeholder={
                  register ? "At least 10 characters" : "Your password"
                }
                required
                minLength={10}
                maxLength={72}
                autoComplete={register ? "new-password" : "current-password"}
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              {busy
                ? "One moment…"
                : register
                  ? "Create your account"
                  : "Sign in to your space"}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="auth-switch">
            {register ? "Already have a space?" : "New around here?"}{" "}
            <Link to={register ? "/login" : "/register"}>
              {register ? "Sign in" : "Create an account"}
            </Link>
          </p>
        </div>
        <span className="auth-footer">
          Thoughtfully built for working together.
        </span>
      </section>
      <aside className="auth-aside">
        <div className="auth-art">
          <div className="art-label">
            <span className="status-dot" /> IN GOOD COMPANY
          </div>
          <h2>
            Great things start
            <br />
            with a shared idea.
          </h2>
          <p>
            A calm place to write, a live connection to your team.
            <br />
            Bring your thoughts. Build something together.
          </p>
          <div className="paper-preview">
            <div className="paper-top">
              <span className="mini-icon">✦</span> The next big thing{" "}
              <span className="tiny-pill">Live</span>
            </div>
            <h3>
              Let’s make something
              <br />
              worth sharing.
            </h3>
            <div className="art-line long" />
            <div className="art-line" />
            <div className="art-selection">
              A little perspective changes everything.
              <span className="art-cursor">Avery</span>
            </div>
            <div className="art-line long" />
            <div className="art-line short" />
            <div className="art-presence">
              <span className="avatar">A</span>
              <span className="avatar peach">J</span>
              <span className="muted">Better, together.</span>
            </div>
          </div>
          <div className="auth-benefits">
            <span>
              <Check size={15} /> Always in sync
            </span>
            <span>
              <Check size={15} /> Yours to share
            </span>
            <span>
              <Check size={15} /> Room to create
            </span>
          </div>
        </div>
        <Quote size={90} className="quote-decoration" />
      </aside>
    </div>
  );
}
