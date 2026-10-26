import { ArrowUpRight, Globe2, ShieldAlert } from 'lucide-react';
import type { LinkAssessment } from '../../lib/links';
import { Modal } from '../ui/Modal';

export function LinkDialog({
  link,
  onClose,
}: {
  link: LinkAssessment | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={Boolean(link)}
      onClose={onClose}
      title="You are leaving Sotto"
      description="This link was shared by another person, not by Sotto."
      size="small"
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          {link?.canOpen ? (
            <a
              className="button button--primary"
              href={link.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={onClose}
            >
              Open link <ArrowUpRight size={17} aria-hidden="true" />
            </a>
          ) : null}
        </>
      }
    >
      {link ? (
        <div className="link-review">
          <div className="link-review__host">
            <span className="link-review__icon">
              <Globe2 size={22} aria-hidden="true" />
            </span>
            <div>
              <span className="eyebrow">Destination</span>
              <strong>{link.host}</strong>
            </div>
          </div>
          <div className="link-review__url" title={link.href}>
            {link.href}
          </div>
          {link.warnings.length ? (
            <div className="link-review__warning">
              <ShieldAlert size={18} aria-hidden="true" />
              <div>
                <strong>Take care</strong>
                <ul>
                  {link.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
          <p className="muted-copy">
            Check the address carefully. Sotto will never ask you to enter your password on another
            website.
          </p>
          {!link.canOpen ? (
            <p className="form-error">
              {link.protocol === 'http:'
                ? 'This link cannot be opened safely because it is not encrypted with HTTPS.'
                : 'This link was blocked because it contains unsafe destination parameters.'}
            </p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
