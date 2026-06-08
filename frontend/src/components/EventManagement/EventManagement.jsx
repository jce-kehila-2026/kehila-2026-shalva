// React hooks for state, effects and memoization.
import { useEffect, useMemo, useState } from 'react'

// Firestore helpers for reading, writing, deleting and live-subscribing.
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'

// Our Firestore database instance.
import { db } from '../../firebase'

// Default group names (fallback when the live groups list is empty).
import { GROUP_NAMES } from '../../utils/groupOptions'

// Date picker used for the event date field.
import BirthDatePicker from '../shared/BirthDatePicker/BirthDatePicker'

// Styles for this screen.
import './EventManagement.css'

// Shared event status helper (so all screens show the same status).
import { computeEventStatus } from '../../utils/eventStatus'


// Firestore collection used for storing and reading events.
const EVENTS_COLLECTION_NAME = 'events'

// Fallback label for events that are not linked to any group.
const NO_GROUP = 'ללא שיוך'

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
  assignedGroup: NO_GROUP,
  status: STATUSES[0],
  contactName: '',
  contactPhone: '',
  contactEmail: '',
}


// Map an event status to a CSS class (status colours live in the CSS file).
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


// Turn a Firestore event into form fields (used when editing).
function createFormFromEvent(event) {
  return {
    name: event.name || '',
    date: event.date || '',
    location: event.location || '',
    description: event.description || '',
    assignedGroup: event.assignedGroup || NO_GROUP,
    status: event.status || STATUSES[0],
    contactName: event.contact?.name || '',
    contactPhone: event.contact?.phone || '',
    contactEmail: event.contact?.email || '',
  }
}


// Turn form fields into the event structure saved in Firestore (text trimmed).
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


// Normalize a Firestore document into a safe event object (with fallbacks).
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


// The submit-button label for the current form mode (saving / edit / add).
function getSubmitButtonText({ saving, isEditing }) {
  if (saving) {
    return 'שומר...'
  }

  if (isEditing) {
    return 'שמירת שינויים'
  }

  return 'הוספת אירוע'
}


// Event management: add, edit, delete, search and open event details.
// `readOnly` hides all editing (used for viewers, who can only browse).
export default function EventManagement({ onOpenEventDetails, readOnly = false }) {
  // Events loaded from Firestore.
  const [events, setEvents] = useState([])

  // Current form values.
  const [form, setForm] = useState(EMPTY_FORM)

  // Holds the selected event id while editing; null means add mode.
  const [editingEventId, setEditingEventId] = useState(null)

  // Search text used to filter the event table.
  const [searchTerm, setSearchTerm] = useState('')

  // Whether the events list is revealed (admins open it with a button; it
  // always shows for read-only viewers who have no add form).
  const [showList, setShowList] = useState(false)

  // UI state for loading, saving, and Firestore errors.
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Group names loaded from Firestore so the dropdown stays up to date.
  const [groupOptions, setGroupOptions] = useState([])

  // Bumped after a successful add so the date picker visually resets.
  const [formResetKey, setFormResetKey] = useState(0)

  // True when we're editing an existing event rather than adding a new one.
  const isEditing = editingEventId !== null

  // Subscribe to the events collection in real time (auto-updates the table).
  useEffect(() => {
    const eventsCollection = collection(db, EVENTS_COLLECTION_NAME)

    const unsubscribe = onSnapshot(
      eventsCollection,
      (snapshot) => {
        // Normalize every document into a safe event object.
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

        // Store the events and clear loading / error states.
        setEvents(eventList)
        setLoading(false)
        setError(null)
      },
      (firebaseError) => {
        // Surface a load error.
        console.error('Error loading events:', firebaseError)

        setError(firebaseError.message)
        setLoading(false)
      },
    )

    // Stop listening when the component is removed from the screen.
    return () => unsubscribe()
  }, [])

  // Load the live group names for the "assign group" dropdown (static fallback).
  useEffect(() => {
    // Guards against state updates after unmount.
    let active = true

    const loadGroups = async () => {
      let names = []

      try {
        // Read the group names from the groups collection.
        const snapshot = await getDocs(collection(db, 'groups'))
        names = snapshot.docs
          .map((groupDoc) => {
            const groupData = groupDoc.data()
            return groupData.groupName || groupData.name || ''
          })
          .filter(Boolean)
      } catch (groupsError) {
        console.error('Error loading groups:', groupsError)
      }

      // Fall back to the static list if nothing came back.
      if (names.length === 0) {
        names = [...GROUP_NAMES]
      }

      // Store a de-duplicated list.
      if (active) {
        setGroupOptions([...new Set(names)])
      }
    }

    loadGroups()

    // Cleanup: mark as unmounted.
    return () => {
      active = false
    }
  }, [])

  // Events filtered by the search box (recomputed only when inputs change).
  const filteredEvents = useMemo(() => {
    // Normalize the search text.
    const searchValue = searchTerm.trim().toLowerCase()

    // No search: show everything.
    if (!searchValue) {
      return events
    }

    // Match the search against the event's combined text.
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

  // Dropdown options: live groups + "no group", plus the currently selected
  // value (so editing an old event keeps its group even if it's gone now).
  const selectableGroups = useMemo(() => {
    const base = [...groupOptions, NO_GROUP]
    const withCurrent =
      form.assignedGroup && !base.includes(form.assignedGroup)
        ? [form.assignedGroup, ...base]
        : base

    return [...new Set(withCurrent)]
  }, [groupOptions, form.assignedGroup])

  // Update one form field by its input name.
  const handleChange = (event) => {
    const { name, value } = event.target

    setForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }))
  }

  // Save a new event or update an existing one in Firestore.
  const handleSubmit = async (event) => {
    // Don't let the form reload the page.
    event.preventDefault()

    // Name, date and location are required.
    const isMissingRequiredField =
      !form.name.trim() ||
      !form.date ||
      !form.location.trim()

    if (isMissingRequiredField) {
      window.alert('נא למלא שם אירוע, תאריך ומיקום.')
      return
    }

    // Show the saving state.
    setSaving(true)

    try {
      // Build the event payload from the form.
      const eventData = createEventFromForm(form)

      if (isEditing) {
        // Update the existing document.
        await updateDoc(doc(db, EVENTS_COLLECTION_NAME, editingEventId), {
          ...eventData,
          updatedAt: serverTimestamp(),
        })
      } else {
        // Create a new document.
        await addDoc(collection(db, EVENTS_COLLECTION_NAME), {
          ...eventData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      }

      // Reset the form back to add mode (bump the key so the date picker clears).
      setForm(EMPTY_FORM)
      setEditingEventId(null)
      setFormResetKey((key) => key + 1)
    } catch (firebaseError) {
      // Report a failed save.
      console.error('Error saving event:', firebaseError)

      window.alert(`שגיאה בשמירת האירוע: ${firebaseError.message}`)
    } finally {
      // Always clear the saving state.
      setSaving(false)
    }
  }

  // Load an existing event into the form and switch to edit mode.
  const handleEdit = (eventToEdit) => {
    setEditingEventId(eventToEdit.id)
    setForm(createFormFromEvent(eventToEdit))

    // Close the list popup so the edit form is visible.
    setShowList(false)

    // Scroll up to the form.
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  // Delete an event after the admin confirms.
  const handleDelete = async (eventId) => {
    const shouldDelete = window.confirm('האם למחוק את האירוע?')

    if (!shouldDelete) {
      return
    }

    try {
      // Remove the document.
      await deleteDoc(doc(db, EVENTS_COLLECTION_NAME, eventId))

      // If we were editing that event, reset the form.
      if (editingEventId === eventId) {
        setForm(EMPTY_FORM)
        setEditingEventId(null)
      }
    } catch (firebaseError) {
      console.error('Error deleting event:', firebaseError)

      window.alert(`שגיאה במחיקת האירוע: ${firebaseError.message}`)
    }
  }

  // Cancel edit mode and clear the form.
  const handleCancelEdit = () => {
    setForm(EMPTY_FORM)
    setEditingEventId(null)
  }

  // Open the full details view for an event (or notify it's not wired yet).
  const handleOpenDetails = (eventItem) => {
    if (typeof onOpenEventDetails === 'function') {
      onOpenEventDetails(eventItem)
      return
    }

    window.alert('מסך פרטי אירוע יחובר בשלב הבא.')
  }

  // The events list markup (search + responsive card grid). Reused both inline
  // (read-only viewers) and inside the modal (admins open it with a button).
  const eventListSection = (
    <section className="event-management-list-section">

      {/* Section title + search. */}
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

      {/* Loading message while fetching, otherwise the cards. */}
      {loading ? (
        <div className="event-management-loading">
          טוען אירועים מ־Firebase...
        </div>
      ) : (
        <div className="event-cards">
          {/* A card per event, or an empty-state note. */}
          {filteredEvents.length > 0 ? (
            filteredEvents.map((eventItem) => (
              <article className="event-card" key={eventItem.id}>

                {/* Card header: name + status badge. */}
                <div className="event-card-head">
                  <h3 className="event-card-name">{eventItem.name}</h3>
                  <span
                    className={`event-management-status ${statusClass(computeEventStatus(eventItem))}`}
                  >
                    {computeEventStatus(eventItem)}
                  </span>
                </div>

                {/* Key details (label + value rows). */}
                <dl className="event-card-details">
                  <div className="event-card-row">
                    <dt>תאריך</dt>
                    <dd>{eventItem.date || '—'}</dd>
                  </div>
                  <div className="event-card-row">
                    <dt>מיקום</dt>
                    <dd>{eventItem.location || '—'}</dd>
                  </div>
                  <div className="event-card-row">
                    <dt>קבוצה</dt>
                    <dd>{eventItem.assignedGroup || '—'}</dd>
                  </div>
                </dl>

                {/* Actions: "פרטים" opens the detail screen; edit/delete for admins. */}
                <div className="event-management-row-actions event-card-actions">
                  <button type="button" onClick={() => handleOpenDetails(eventItem)}>
                    פרטים
                  </button>

                  {!readOnly && (
                    <>
                      <button type="button" onClick={() => handleEdit(eventItem)}>
                        עריכה
                      </button>

                      <button type="button" className="danger" onClick={() => handleDelete(eventItem.id)}>
                        מחיקה
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))
          ) : (
            <div className="event-management-empty">אין אירועים להצגה כרגע.</div>
          )}
        </div>
      )}
    </section>
  )

  return (
    <main className="event-management-container" dir="rtl">
      <section className="event-management-card">

        {/* Header: just the event counter (the sidebar labels the screen). */}
        <header className="event-management-header">
          <div className="event-management-count">
            <span>{events.length}</span>
            <small>אירועים</small>
          </div>
        </header>

        {/* Error banner shown if the events failed to load. */}
        {error && (
          <div className="event-management-error">
            שגיאה בטעינת אירועים מ־Firebase: {error}
          </div>
        )}

        {/* Add / edit event form (hidden for read-only viewers). */}
        {!readOnly && (
        <form className="event-management-form" onSubmit={handleSubmit}>

          {/* Title changes between add and edit mode. */}
          <h2>
            {isEditing ? 'עריכת אירוע' : 'הוספת אירוע חדש'}
          </h2>

          {/* Two-column grid of the main fields. */}
          <div className="event-management-form-grid">

            {/* Event name. */}
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

            {/* Event date (custom picker). */}
            <label>
              תאריך

              <BirthDatePicker
                key={editingEventId ?? `new-${formResetKey}`}
                value={form.date}
                onChange={(date) => setForm((currentForm) => ({ ...currentForm, date }))}
                pastYears={3}
                futureYears={6}
              />
            </label>

            {/* Location. */}
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

            {/* Assigned group dropdown. */}
            <label>
              שיוך קבוצה

              <select
                name="assignedGroup"
                value={form.assignedGroup}
                onChange={handleChange}
              >
                {selectableGroups.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            </label>

            {/* Status dropdown. */}
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

            {/* Contact name. */}
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

            {/* Contact phone. */}
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

            {/* Contact email. */}
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

          {/* Full-width description field. */}
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

          {/* Submit + list-toggle + cancel buttons. */}
          <div className="event-management-actions">
            <button
              type="submit"
              className="event-management-primary-btn"
              disabled={saving}
            >
              {getSubmitButtonText({ saving, isEditing })}
            </button>

            {/* Reveal / hide the events list (the card grid). */}
            <button
              type="button"
              className="event-management-secondary-btn"
              onClick={() => setShowList((show) => !show)}
            >
              {showList ? 'הסתר רשימת אירועים' : 'רשימת אירועים'}
            </button>

            {/* Cancel only appears while editing (spans the full row). */}
            {isEditing && (
              <button
                type="button"
                className="event-management-secondary-btn event-management-cancel-btn"
                onClick={handleCancelEdit}
              >
                ביטול עריכה
              </button>
            )}
          </div>
        </form>
        )}

        {/* Read-only viewers see the list inline; admins open it in a modal
            window via the "רשימת אירועים" button. */}
        {readOnly && eventListSection}

        {!readOnly && showList && (
          <div className="event-management-modal-overlay" onClick={() => setShowList(false)}>
            <div
              className="event-management-modal"
              role="dialog"
              aria-modal="true"
              onClick={(event) => event.stopPropagation()}
            >
              {/* Sticky bar holding the close button. */}
              <div className="event-management-modal-bar">
                <button
                  type="button"
                  className="event-management-modal-close"
                  onClick={() => setShowList(false)}
                  aria-label="סגירה"
                >
                  ✕
                </button>
              </div>

              {eventListSection}
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
