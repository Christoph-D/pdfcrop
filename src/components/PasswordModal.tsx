import "./PasswordModal.css";

interface PasswordModalProps {
  fileName: string;
  passwordInput: string;
  passwordError: string | null;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export default function PasswordModal({
  fileName,
  passwordInput,
  passwordError,
  onPasswordChange,
  onSubmit,
  onCancel,
}: PasswordModalProps) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>Password required</h2>
        <p>
          <code>{fileName}</code> is password protected.
        </p>
        {passwordError && <p className="modal__error">{passwordError}</p>}
        <input
          type="password"
          autoFocus
          value={passwordInput}
          onChange={(e) => onPasswordChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit();
          }}
          placeholder="Password"
          className="modal__input"
        />
        <div className="modal__actions">
          <button type="button" className="modal__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="modal__ok"
            onClick={onSubmit}
            disabled={!passwordInput}
          >
            Unlock
          </button>
        </div>
      </div>
    </div>
  );
}
