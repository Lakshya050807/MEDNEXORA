import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';

export default function InfoDialog({ title, eyebrow, onClose, children }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      className="info-dialog"
      ref={dialogRef}
      aria-labelledby="dialog-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current.close();
      }}
    >
      <button className="dialog-close" type="button" onClick={() => dialogRef.current?.close()} aria-label="Close dialog">
        <Icon name="close" size={20} />
      </button>
      {eyebrow && <p className="eyebrow dialog-eyebrow">{eyebrow}</p>}
      <h2 id="dialog-title">{title}</h2>
      <div className="dialog-content">{children}</div>
    </dialog>
  );
}

