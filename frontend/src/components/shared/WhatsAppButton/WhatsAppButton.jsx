// WhatsAppButton — a one-tap "send on WhatsApp" button. Opens a chat with a
// pre-filled message. When `requirePhone` is set (the default) and there's no
// valid phone, it renders a muted, disabled chip instead. Clicks are stopped
// from bubbling, so it's safe to drop inside clickable rows/cards.

// Helpers that build the WhatsApp URL and validate the phone.
import { buildWhatsAppUrl, hasValidPhone } from '../../../utils/whatsapp';

// Styles for this widget.
import './WhatsAppButton.css';


// The inline WhatsApp logo SVG.
function WhatsAppGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.51 5.26l-.999 3.648 3.978-1.717zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" />
    </svg>
  );
}


function WhatsAppButton({
  phone,
  message,
  label = 'וואטסאפ',
  title,
  compact = false,
  requirePhone = true,
}) {
  // Whether we have a usable phone number.
  const valid = hasValidPhone(phone);

  // No valid phone (and one is required): render a disabled chip.
  if (requirePhone && !valid) {
    return (
      <span className={`wa-btn wa-btn--disabled ${compact ? 'wa-btn--compact' : ''}`} title="אין מספר טלפון">
        <WhatsAppGlyph />
        {label && <span className="wa-btn-label">{label}</span>}
      </span>
    );
  }

  // Otherwise: a link that opens WhatsApp (click doesn't bubble to the row).
  return (
    <a
      className={`wa-btn ${compact ? 'wa-btn--compact' : ''}`}
      href={buildWhatsAppUrl(phone, message)}
      target="_blank"
      rel="noreferrer"
      title={title || 'שליחה בוואטסאפ'}
      onClick={(event) => event.stopPropagation()}
    >
      <WhatsAppGlyph />
      {label && <span className="wa-btn-label">{label}</span>}
    </a>
  );
}

export default WhatsAppButton;
