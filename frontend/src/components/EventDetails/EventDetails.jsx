// Import styles for the EventDetails component.
import './EventDetails.css'

// Shared status logic, so this screen shows the SAME status as every other one
// (derived from the event's date) instead of a separate stored value.
import { computeEventStatus } from '../../utils/eventStatus'

// Default text for missing event fields.
const FALLBACK = 'לא צוין'

// Shared title id for accessibility.
const TITLE_ID = 'event-details-title'

// Maps each event status to its matching CSS class.
function statusClass(status) {
  switch (status) {
    case 'פעיל':
      return 'status-active'
    case 'מתוכנן':
      return 'status-planned'
    case 'הסתיים':
      return 'status-finished'
    case 'בוטל':
      return 'status-cancelled'
    default:
      return ''
  }
}

// Checks if the event has any contact details to display.
function hasContact(contact) {
  return Boolean(contact && (contact.name || contact.phone || contact.email))
}

// Builds a clean phone link for the tel: href.
function phoneHref(phone) {
  return `tel:${String(phone).replace(/[^\d+]/g, '')}`
}

// Main Event Details component. Renders the given event; missing fields fall
// back to "לא צוין".
export default function EventDetails({ event = null, onBack }) {
  // Handles the Back button using a custom callback or browser history.
  const handleBack = () => {
    if (typeof onBack === 'function') {
      onBack()
      return
    }

    // If no custom onBack was provided, try to use the browser's Back button behavior.
    if (typeof window !== 'undefined' && window.history && window.history.length > 1) {
      window.history.back()
    }
  }

  // Prepare safe values for display, with fallback text for missing fields.
  const name = event?.name || FALLBACK
  const date = event?.date || FALLBACK
  const location = event?.location || FALLBACK
  const description = event?.description || FALLBACK

  // Status is derived from the date (future = מתוכנן, today = פעיל, past =
  // הסתיים; בוטל is a manual override), matching the other screens.
  const status = event ? computeEventStatus(event) : FALLBACK

  // Support both the new field name and older group field name.
  const group = event?.assignedGroup || event?.group || FALLBACK

  // Contact is handled separately because it is an object.
  const contact = event?.contact

  return (
    <main
      className="event-details-container"
      dir="rtl"
      aria-labelledby={TITLE_ID}
    >
      {/* Main event details card */}
      <article className="event-details-card">
        {/* Header with event title and status */}
        <header className="event-details-header">
          <div className="event-details-title-wrap">
            <div className="event-details-eyebrow">פרטי אירוע</div>
            <h1 id={TITLE_ID} className="event-details-title">{name}</h1>
          </div>

          <span className={`event-details-status ${statusClass(status)}`}>
            {status}
          </span>
        </header>

        {/* Event summary fields */}
        <div className="event-details-grid">
          <div className="event-detail-item">
            <div className="event-detail-label">תאריך</div>
            <div className="event-detail-value">{date}</div>
          </div>

          <div className="event-detail-item">
            <div className="event-detail-label">מיקום</div>
            <div className="event-detail-value">{location}</div>
          </div>

          <div className="event-detail-item">
            <div className="event-detail-label">קבוצה משויכת</div>
            <div className="event-detail-value">{group}</div>
          </div>

          {/* Contact details are shown only when they exist */}
          <div className="event-detail-item">
            <div className="event-detail-label">איש קשר</div>
            <div className="event-detail-value">
              {hasContact(contact) ? (
                <ul className="event-contact-list">
                  {contact.name && (
                    <li className="event-contact-name">{contact.name}</li>
                  )}

                  {contact.phone && (
                    <li>
                      <a href={phoneHref(contact.phone)} dir="ltr">
                        {contact.phone}
                      </a>
                    </li>
                  )}

                  {contact.email && (
                    <li>
                      <a href={`mailto:${contact.email}`} dir="ltr">
                        {contact.email}
                      </a>
                    </li>
                  )}
                </ul>
              ) : (
                <span className="event-contact-empty">לא צוינו פרטי קשר</span>
              )}
            </div>
          </div>
        </div>

        {/* Event description */}
        <section className="event-details-description" aria-label="תיאור האירוע">
          <h3>תיאור האירוע</h3>
          <p>{description}</p>
        </section>

        {/* Event pictures (if any) */}
        {event?.imageUrls && event.imageUrls.length > 0 && (
          <section className="event-details-description" aria-label="תמונות מהאירוע" style={{ marginTop: '20px' }}>
            <h3>תמונות מהאירוע ({event.imageUrls.length})</h3>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', 
              gap: '12px',
              marginTop: '12px'
            }}>
              {event.imageUrls.map((url, idx) => (
                <a 
                  key={idx} 
                  href={url} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  style={{ 
                    borderRadius: '12px', 
                    overflow: 'hidden', 
                    border: '1px solid var(--border)', 
                    display: 'block', 
                    height: '140px',
                    boxShadow: 'var(--shadow-sm)',
                    position: 'relative'
                  }}
                >
                  <img 
                    src={url} 
                    alt={`תמונה מהאירוע ${idx + 1}`} 
                    style={{ 
                      width: '100%', 
                      height: '100%', 
                      objectFit: 'cover',
                      display: 'block',
                      transition: 'transform 0.2s'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  />
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Screen actions */}
        <div className="event-details-actions">
          <button
            type="button"
            className="event-details-back-btn"
            onClick={handleBack}
            aria-label="חזרה למסך הקודם"
          >
            חזרה
          </button>
        </div>
      </article>
    </main>
  )
}
