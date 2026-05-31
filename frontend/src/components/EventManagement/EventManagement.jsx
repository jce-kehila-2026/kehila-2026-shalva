import { useEffect, useMemo, useState } from 'react'

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'

import { db } from '../../firebase'
import './EventManagement.css'

// Firestore collection used for storing and reading events.
const EVENTS_COLLECTION_NAME = 'events'

// Static group options used in the event form.
const GROUPS = [
  'קבוצה א׳',
  'קבוצה ב׳ - מדריכים בכירים',
  'קבוצה ג׳',
  'ללא שיוך',
]

// Static status options used in the event form.
const STATUSES = [
  'מתוכנן',
  'פעיל',
  'הסתיים',
  'בוטל',
]

// Default form state used when adding a new event or clearing the form.
const EMPTY_FORM = {
  name: '',
  date: '',
  location: '',
  description: '',
  assignedGroup: GROUPS[0],
  status: STATUSES[0],
  contactName: '',
  contactPhone: '',
  contactEmail: '',
}

/**
 * Maps an event status to a CSS class.
 * This keeps the status colors controlled by the CSS file.
 */
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

/**
 * Converts a Firestore event object into form fields.
 * Used when the admin clicks the edit button.
 */
function createFormFromEvent(event) {
  return {
    name: event.name || '',
    date: event.date || '',
    location: event.location || '',
    description: event.description || '',
    assignedGroup: event.assignedGroup || GROUPS[0],
    status: event.status || STATUSES[0],
    contactName: event.contact?.name || '',
    contactPhone: event.contact?.phone || '',
    contactEmail: event.contact?.email || '',
  }
}

/**
 * Converts form fields into the event structure saved in Firestore.
 * Text fields are trimmed before saving.
 */
function createEventFromForm(form) {
  return {
    name: form.name.trim(),
    date: form.date,
    location: form.location.trim(),
    description: form.description.trim(),
    assignedGroup: form.assignedGroup,
    status: form.status,
    contact: {
      name: form.contactName.trim(),
      phone: form.contactPhone.trim(),
      email: form.contactEmail.trim(),
    },
  }
}

/**
 * Normalizes a Firestore document into a safe event object.
 * Fallback values prevent the UI from breaking when optional fields are missing.
 */
function normalizeEvent(documentSnapshot) {
  const data = documentSnapshot.data()

  return {
    id: documentSnapshot.id,
    name: data.name || '',
    date: data.date || '',
    location: data.location || '',
    description: data.description || '',
    assignedGroup: data.assignedGroup || 'ללא שיוך',
    status: data.status || 'מתוכנן',
    contact: data.contact || {},
  }
}

/**
 * Returns the correct submit button label according to the current form mode.
 */
function getSubmitButtonText({ saving, isEditing }) {
  if (saving) {
    return 'שומר...'
  }

  if (isEditing) {
    return 'שמירת שינויים'
  }

  return 'הוספת אירוע'
}

/**
 * Screen 11 — Event Management.
 * Allows the admin to add, edit, delete, search, and open event details.
 */
export default function EventManagement({ onOpenEventDetails }) {
  // Events loaded from Firestore.
  const [events, setEvents] = useState([])

  // Current form values.
  const [form, setForm] = useState(EMPTY_FORM)

  // Holds the selected event id while editing; null means add mode.
  const [editingEventId, setEditingEventId] = useState(null)

  // Search text used to filter the event table.
  const [searchTerm, setSearchTerm] = useState('')

  // UI state for loading, saving, and Firestore errors.
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const isEditing = editingEventId !== null

  /**
   * Subscribes to the events collection in real time.
   * The table updates automatically whenever Firestore data changes.
   */
  useEffect(() => {
    const eventsCollection = collection(db, EVENTS_COLLECTION_NAME)

    const unsubscribe = onSnapshot(
      eventsCollection,
      (snapshot) => {
        const eventList = snapshot.docs.map(normalizeEvent)

        // Sort events by date while keeping undated events at the bottom.
        eventList.sort((firstEvent, secondEvent) => {
          if (!firstEvent.date) {
            return 1
          }

          if (!secondEvent.date) {
            return -1
          }

          return firstEvent.date.localeCompare(secondEvent.date)
        })

        setEvents(eventList)
        setLoading(false)
        setError(null)
      },
      (firebaseError) => {
        console.error('Error loading events:', firebaseError)

        setError(firebaseError.message)
        setLoading(false)
      },
    )

    // Stop listening when the component is removed from the screen.
    return () => unsubscribe()
  }, [])

  /**
   * Filters the event list by name, location, group, or status.
   * useMemo avoids recalculating unless the events or search text changed.
   */
  const filteredEvents = useMemo(() => {
    const searchValue = searchTerm.trim().toLowerCase()

    if (!searchValue) {
      return events
    }

    return events.filter((event) => {
      const searchableText = [
        event.name,
        event.location,
        event.assignedGroup,
        event.status,
      ]
        .join(' ')
        .toLowerCase()

      return searchableText.includes(searchValue)
    })
  }, [events, searchTerm])

  /**
   * Updates one form field according to the input name.
   */
  const handleChange = (event) => {
    const { name, value } = event.target

    setForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }))
  }

  /**
   * Saves a new event or updates an existing event in Firestore.
   */
  const handleSubmit = async (event) => {
    event.preventDefault()

    const isMissingRequiredField =
      !form.name.trim() ||
      !form.date ||
      !form.location.trim()

    if (isMissingRequiredField) {
      window.alert('נא למלא שם אירוע, תאריך ומיקום.')
      return
    }

    setSaving(true)

    try {
      const eventData = createEventFromForm(form)

      if (isEditing) {
        await updateDoc(doc(db, EVENTS_COLLECTION_NAME, editingEventId), {
          ...eventData,
          updatedAt: serverTimestamp(),
        })
      } else {
        await addDoc(collection(db, EVENTS_COLLECTION_NAME), {
          ...eventData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      }

      setForm(EMPTY_FORM)
      setEditingEventId(null)
    } catch (firebaseError) {
      console.error('Error saving event:', firebaseError)

      window.alert(`שגיאה בשמירת האירוע: ${firebaseError.message}`)
    } finally {
      setSaving(false)
    }
  }

  /**
   * Loads an existing event into the form and switches to edit mode.
   */
  const handleEdit = (eventToEdit) => {
    setEditingEventId(eventToEdit.id)
    setForm(createFormFromEvent(eventToEdit))

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  /**
   * Deletes an event from Firestore after admin confirmation.
   */
  const handleDelete = async (eventId) => {
    const shouldDelete = window.confirm('האם למחוק את האירוע?')

    if (!shouldDelete) {
      return
    }

    try {
      await deleteDoc(doc(db, EVENTS_COLLECTION_NAME, eventId))

      if (editingEventId === eventId) {
        setForm(EMPTY_FORM)
        setEditingEventId(null)
      }
    } catch (firebaseError) {
      console.error('Error deleting event:', firebaseError)

      window.alert(`שגיאה במחיקת האירוע: ${firebaseError.message}`)
    }
  }

  /**
   * Cancels edit mode and clears the form.
   */
  const handleCancelEdit = () => {
    setForm(EMPTY_FORM)
    setEditingEventId(null)
  }

  /**
   * Sends the selected event to Screen 12.
   */
  const handleOpenDetails = (eventItem) => {
    if (typeof onOpenEventDetails === 'function') {
      onOpenEventDetails(eventItem)
      return
    }

    window.alert('מסך פרטי אירוע יחובר בשלב הבא.')
  }

  return (
    <main className="event-management-container" dir="rtl">
      <section className="event-management-card">
        <header className="event-management-header">
          <div>
            <div className="event-management-eyebrow">
              מסך 11
            </div>

            <h1 className="event-management-title">
              ניהול אירועים
            </h1>

            <p className="event-management-subtitle">
              הוספה, עריכה, מחיקה ושיוך אירועים לקבוצות. הנתונים נשמרים ב־Firebase.
            </p>
          </div>

          <div className="event-management-count">
            <span>{events.length}</span>
            <small>אירועים</small>
          </div>
        </header>

        {error && (
          <div className="event-management-error">
            שגיאה בטעינת אירועים מ־Firebase: {error}
          </div>
        )}

        <form className="event-management-form" onSubmit={handleSubmit}>
          <h2>
            {isEditing ? 'עריכת אירוע' : 'הוספת אירוע חדש'}
          </h2>

          <div className="event-management-form-grid">
            <label>
              שם האירוע

              <input
                type="text"
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="לדוגמה: יום ספורט קהילתי"
              />
            </label>

            <label>
              תאריך

              <input
                type="date"
                name="date"
                value={form.date}
                onChange={handleChange}
              />
            </label>

            <label>
              מיקום

              <input
                type="text"
                name="location"
                value={form.location}
                onChange={handleChange}
                placeholder="לדוגמה: מרכז שלווה, ירושלים"
              />
            </label>

            <label>
              שיוך קבוצה

              <select
                name="assignedGroup"
                value={form.assignedGroup}
                onChange={handleChange}
              >
                {GROUPS.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            </label>

            <label>
              סטטוס

              <select
                name="status"
                value={form.status}
                onChange={handleChange}
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>

            <label>
              איש קשר

              <input
                type="text"
                name="contactName"
                value={form.contactName}
                onChange={handleChange}
                placeholder="שם איש קשר"
              />
            </label>

            <label>
              טלפון איש קשר

              <input
                type="tel"
                name="contactPhone"
                value={form.contactPhone}
                onChange={handleChange}
                placeholder="050-0000000"
                dir="ltr"
              />
            </label>

            <label>
              אימייל איש קשר

              <input
                type="email"
                name="contactEmail"
                value={form.contactEmail}
                onChange={handleChange}
                placeholder="name@example.com"
                dir="ltr"
              />
            </label>
          </div>

          <label className="event-management-description-label">
            תיאור האירוע

            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder="כתוב תיאור קצר של האירוע"
              rows="4"
            />
          </label>

          <div className="event-management-actions">
            <button
              type="submit"
              className="event-management-primary-btn"
              disabled={saving}
            >
              {getSubmitButtonText({ saving, isEditing })}
            </button>

            {isEditing && (
              <button
                type="button"
                className="event-management-secondary-btn"
                onClick={handleCancelEdit}
              >
                ביטול עריכה
              </button>
            )}
          </div>
        </form>

        <section className="event-management-list-section">
          <div className="event-management-list-header">
            <h2>רשימת אירועים</h2>

            <input
              type="search"
              className="event-management-search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="חיפוש לפי שם, מיקום, קבוצה או סטטוס"
            />
          </div>

          {loading ? (
            <div className="event-management-loading">
              טוען אירועים מ־Firebase...
            </div>
          ) : (
            <div className="event-management-table-wrap">
              <table className="event-management-table">
                <thead>
                  <tr>
                    <th>שם</th>
                    <th>תאריך</th>
                    <th>מיקום</th>
                    <th>קבוצה</th>
                    <th>סטטוס</th>
                    <th>פעולות</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredEvents.length > 0 ? (
                    filteredEvents.map((eventItem) => (
                      <tr key={eventItem.id}>
                        <td>{eventItem.name}</td>
                        <td>{eventItem.date}</td>
                        <td>{eventItem.location}</td>
                        <td>{eventItem.assignedGroup}</td>

                        <td>
                          <span
                            className={`event-management-status ${statusClass(eventItem.status)}`}
                          >
                            {eventItem.status}
                          </span>
                        </td>

                        <td>
                          <div className="event-management-row-actions">
                            <button
                              type="button"
                              onClick={() => handleOpenDetails(eventItem)}
                            >
                              פרטים
                            </button>

                            <button
                              type="button"
                              onClick={() => handleEdit(eventItem)}
                            >
                              עריכה
                            </button>

                            <button
                              type="button"
                              className="danger"
                              onClick={() => handleDelete(eventItem.id)}
                            >
                              מחיקה
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="6" className="event-management-empty">
                        אין אירועים להצגה כרגע.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
    </main>
  )
}
