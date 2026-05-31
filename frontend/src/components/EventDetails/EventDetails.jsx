import { useState, useEffect } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebase'

// Import styles for the EventDetails component.
import './EventDetails.css'

// Temporary event data until Firebase is connected.
const MOCK_EVENT = {
  // Main event details
  name: 'יום ספורט קהילתי',
  date: '15 ביוני 2026, 10:00',
  location: 'מרכז שלווה, ירושלים',

  // Long text shown in the description section
  description: [
    'יום פעילות ספורטיבית מותאמת לכלל המשתתפים. התוכנית כוללת חימום קבוצתי, תחנות ספורט, הפסקת ארוחת בוקר ופעילות סיום משותפת.',
    'נא להגיע עם בגדים נוחים ובקבוק מים.',
  ].join('\n'),

  // Group connected to this event
  assignedGroup: 'קבוצה ב׳ - מדריכים בכירים',

  // Used to choose the status badge style
  status: 'מתוכנן',

  // Contact person for the event
  contact: {
    name: 'דנה כהן',
    phone: '050-1234567',
    email: 'dana@example.com',
  },
}

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

// Main Event Details component. Uses mock data until a real event is passed in.
export default function EventDetails({ event: propEvent, onBack }) {
  const { eventId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [event, setEvent] = useState(propEvent || location.state?.event || null);
  const [loading, setLoading] = useState(!event);

  useEffect(() => {
    if (event) return;
    const fetchEvent = async () => {
      try {
        const docRef = doc(db, 'events', eventId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setEvent({ id: docSnap.id, ...docSnap.data() });
        }
      } catch (err) {
        console.error("Error fetching event details:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchEvent();
  }, [eventId, event]);

  const handleBack = () => {
    if (typeof onBack === 'function') {
      onBack()
      return
    }
    navigate(-1);
  }

  if (loading) {
    return <div className="event-details-container" dir="rtl" style={{ textAlign: 'center', padding: '40px' }}>טוען פרטי אירוע...</div>;
  }

  // Prepare safe values for display, with fallback text for missing fields.
  const name = event?.name || FALLBACK
  const date = event?.date || FALLBACK
  const eventLocation = event?.location || FALLBACK
  const description = event?.description || FALLBACK
  const status = event?.status || FALLBACK

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
            <div className="event-detail-value">{eventLocation}</div>
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
