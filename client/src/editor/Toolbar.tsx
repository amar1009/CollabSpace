import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Quote,
  Link2,
  Undo2,
  Redo2,
  ChevronDown,
  RemoveFormatting,
} from "lucide-react";
export function Toolbar({
  editor,
  disabled,
}: {
  editor: Editor | null;
  disabled: boolean;
}) {
  if (!editor) return <div className="editor-toolbar" />;
  const tools = [
    {
      label: "Bold",
      icon: Bold,
      active: "bold",
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      icon: Italic,
      active: "italic",
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "Underline",
      icon: Underline,
      active: "underline",
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      label: "Bullet list",
      icon: List,
      active: "bulletList",
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      icon: ListOrdered,
      active: "orderedList",
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Blockquote",
      icon: Quote,
      active: "blockquote",
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
  ];
  return (
    <div className="editor-toolbar">
      <div className="toolbar-group">
        <button
          aria-label="Undo"
          title="Undo"
          disabled={disabled || !editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 size={17} />
        </button>
        <button
          aria-label="Redo"
          title="Redo"
          disabled={disabled || !editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 size={17} />
        </button>
      </div>
      <div className="toolbar-group">
        <label className="format-select">
          <select
            aria-label="Text style"
            disabled={disabled}
            value={
              editor.isActive("heading", { level: 1 })
                ? "1"
                : editor.isActive("heading", { level: 2 })
                  ? "2"
                  : editor.isActive("heading", { level: 3 })
                    ? "3"
                    : "0"
            }
            onChange={(e) => {
              const level = Number(e.target.value);
              if (!level) editor.chain().focus().setParagraph().run();
              else
                editor
                  .chain()
                  .focus()
                  .setHeading({ level: level as 1 | 2 | 3 })
                  .run();
            }}
          >
            <option value="0">Normal text</option>
            <option value="1">Heading 1</option>
            <option value="2">Heading 2</option>
            <option value="3">Heading 3</option>
          </select>
          <ChevronDown size={13} />
        </label>
      </div>
      <div className="toolbar-group">
        {tools.slice(0, 3).map((t) => (
          <button
            key={t.label}
            disabled={disabled}
            title={t.label}
            aria-label={t.label}
            aria-pressed={editor.isActive(t.active)}
            onClick={t.run}
          >
            <t.icon size={17} />
          </button>
        ))}
      </div>
      <div className="toolbar-group">
        {tools.slice(3).map((t) => (
          <button
            key={t.label}
            disabled={disabled}
            title={t.label}
            aria-label={t.label}
            aria-pressed={editor.isActive(t.active)}
            onClick={t.run}
          >
            <t.icon size={17} />
          </button>
        ))}
        <button
          disabled={disabled}
          aria-label="Insert link"
          title="Insert link"
          aria-pressed={editor.isActive("link")}
          onClick={() => {
            const url = window.prompt(
              "Link URL (https://…)",
              String(editor.getAttributes("link").href ?? ""),
            );
            if (url === null) return;
            if (!url) editor.chain().focus().unsetLink().run();
            else if (/^https?:\/\//i.test(url))
              editor
                .chain()
                .focus()
                .extendMarkRange("link")
                .setLink({ href: url })
                .run();
          }}
        >
          <Link2 size={17} />
        </button>
      </div>
      <button
        disabled={disabled}
        aria-label="Clear formatting"
        title="Clear formatting"
        onClick={() =>
          editor.chain().focus().unsetAllMarks().clearNodes().run()
        }
      >
        <RemoveFormatting size={17} />
      </button>
      <span className="toolbar-right">
        {disabled ? "View only" : "Editing"}
      </span>
    </div>
  );
}
