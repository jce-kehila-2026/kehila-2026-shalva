// EventManagement — create, edit and delete community events. The list stays
// live via an onSnapshot subscription, statuses are derived from the event
// date (shared eventStatus util), and `readOnly` turns the screen into a
// browse-only view for viewers.

// React hooks for state, effects and memoization.
import { useEffect, useMemo, useState } from 'react'

// Firestore helpers for reading, writing, deleting and live-subscribing.
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'

// Our Firestore database + Storage instances.
import { db, storage } from '../../firebase'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'

// Saturday is not a permitted event date.
import { isSaturdayDateValue } from '../../utils/activityDays'

// Date picker used for the event date field.
import BirthDatePicker from '../shared/BirthDatePicker/BirthDatePicker'

// Styles for this screen.
import './EventManagement.css'

// Shared event status helper (so all screens show the same status).
import { computeEventStatus } from '../../utils/eventStatus'

// Shared date formatter: render date-only event dates as DD-MM-YYYY.
import { formatDateOnlyForDisplay } from '../../utils/dateDisplay'

// Shared collapsible advanced-search bar (free text + per-field filters).
import SearchFilters from '../shared/SearchFilters/SearchFilters'


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
  imageUrls: [],
}


const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const isValidImage = (file) => {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    alert(`הקובץ ${file.name} אינו תמונה מסוג JPG, PNG או WEBP.`);
    return false;
  }

  if (file.size > 5 * 1024 * 1024) {
    alert(`התמונה ${file.name} גדולה מדי (מקסימום 5MB).`);
    return false;
  }

  return true;
};



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
    imageUrls: event.imageUrls || [],
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
    imageUrls: form.imageUrls || [],
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
    imageUrls: data.imageUrls || [],
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
export default function EventManagement({ onOpenEventDetails, readOnly = false, registerBack }) {
  // Events loaded from Firestore.
  const [events, setEvents] = useState([])

  // Current form values.
  const [form, setForm] = useState(EMPTY_FORM)

  // Holds the selected event id while editing; null means add mode.
  const [editingEventId, setEditingEventId] = useState(null)

  // Holds the event ID for upload/saving purposes (pre-generated for additions).
  const [currentEventId, setCurrentEventId] = useState('')

  // True while files are uploading to storage.
  const [uploading, setUploading] = useState(false)

  // Holds the event whose pictures we are viewing in the modal (null when none).
  const [viewingPicturesEvent, setViewingPicturesEvent] = useState(null)

  // Holds the event whose FULL details we are viewing in the modal (null = none).
  const [viewingDetailsEvent, setViewingDetailsEvent] = useState(null)

  // Search text used to filter the event table.
  const [searchTerm, setSearchTerm] = useState('')

  // Structured "advanced filters" (empty string means "don't filter").
  const [filters, setFilters] = useState({ status: '', assignedGroup: '' })

  // Update one filter by name (handed to the shared SearchFilters component).
  const updateFilter = (name, value) => {
    setFilters((current) => ({ ...current, [name]: value }))
  }

  // Reset every structured filter.
  const clearFilters = () => {
    setFilters({ status: '', assignedGroup: '' })
  }

  // Whether the add/edit form is open. The list always shows first; the form
  // opens only via the "הוספת אירוע" button or when editing an event.
  const [showForm, setShowForm] = useState(false)

  // On phones event cards start collapsed, like the other management lists.
  const [expandedEventId, setExpandedEventId] = useState(null)

  // Dashboard back button: an open form returns to the list first.
  useEffect(() => {
    if (!registerBack) return
    registerBack(() => {
      if (showForm) {
        setForm(EMPTY_FORM)
        setEditingEventId(null)
        setCurrentEventId('')
        setShowForm(false)
        return true
      }
      return false
    })
  }, [registerBack, showForm])

  // Opens the form for creating a new event, pre-generating a Firestore ID.
  const handleOpenAddForm = () => {
    setForm(EMPTY_FORM)
    setEditingEventId(null)
    setCurrentEventId(doc(collection(db, EVENTS_COLLECTION_NAME)).id)
    // Start with a clean Saturday error so a previous attempt doesn't linger.
    setDateError('')
    setShowForm(true)
  }

  // UI state for loading, saving, and Firestore errors.
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Inline error shown when the chosen event date falls on a Saturday.
  const [dateError, setDateError] = useState('')

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

      // Live groups only — selection lists always mirror the real system.
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

  // Events filtered by the free-text search AND the structured filters
  // (recomputed only when inputs change).
  const filteredEvents = useMemo(() => {
    // Normalize the search text.
    const searchValue = searchTerm.trim().toLowerCase()

    return events.filter((event) => {
      // Advanced filter — status, matched against the DISPLAYED (derived from
      // the date) status, so it lines up with the badge the admin sees.
      if (filters.status && computeEventStatus(event) !== filters.status) {
        return false
      }

      // Advanced filter — assigned group.
      if (filters.assignedGroup && event.assignedGroup !== filters.assignedGroup) {
        return false
      }

      // Free-text search — across every text column of the event.
      if (searchValue) {
        const searchableText = [
          event.name,
          event.location,
          event.assignedGroup,
          event.status,
          event.date,
          event.description,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()

        if (!searchableText.includes(searchValue)) {
          return false
        }
      }

      return true
    })
  }, [events, searchTerm, filters])

  // The advanced-panel fields: filter by status and by assigned group.
  const eventFilterFields = [
    {
      name: 'status',
      label: 'סטטוס',
      type: 'select',
      placeholder: 'כל הסטטוסים',
      options: STATUSES,
    },
    {
      name: 'assignedGroup',
      label: 'קבוצה משויכת',
      type: 'select',
      placeholder: 'כל הקבוצות',
      options: [...groupOptions, NO_GROUP],
    },
  ]

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

  // Handle uploading multiple event images to Firebase Storage.
  const handleImageUpload = async (e) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setUploading(true)
    const uploadedUrls = [...(form.imageUrls || [])]

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (!isValidImage(file)) continue

        const extension = (file.name.split('.').pop() || 'jpg').toLowerCase()
        const storageRef = ref(storage, `events/${currentEventId}/img-${Date.now()}-${i}.${extension}`)
        await uploadBytes(storageRef, file)
        const url = await getDownloadURL(storageRef)
        uploadedUrls.push(url)
      }

      setForm((prev) => ({
        ...prev,
        imageUrls: uploadedUrls,
      }))
    } catch (error) {
      console.error('Error uploading images:', error)
      window.alert('אירעה שגיאה בהעלאת התמונות. ודא/י שחוקי ה-Storage נפרסו.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  // Remove an uploaded image from the list by its index.
  const handleRemoveImage = (indexToRemove) => {
    setForm((prev) => ({
      ...prev,
      imageUrls: (prev.imageUrls || []).filter((_, idx) => idx !== indexToRemove),
    }))
  }

  // Save a new event or update an existing one in Firestore.
  const handleSubmit = async (event) => {
    // Don't let the form reload the page.
    event.preventDefault()

    // Saturday is not a permitted event date — re-check before any write
    // (uploadBytes / addDoc / setDoc / updateDoc), independent of the input guard.
    if (isSaturdayDateValue(form.date)) {
      setDateError('לא ניתן לקבוע אירוע ליום שבת.')
      return
    }

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
        // Create a new document using the pre-generated currentEventId.
        await setDoc(doc(db, EVENTS_COLLECTION_NAME, currentEventId), {
          ...eventData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      }

      // Reset the form back to add mode (bump the key so the date picker
      // clears) and return to the list view.
      setForm(EMPTY_FORM)
      setEditingEventId(null)
      setCurrentEventId('')
      setFormResetKey((key) => key + 1)
      setShowForm(false)
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
    setCurrentEventId(eventToEdit.id)
    setForm(createFormFromEvent(eventToEdit))

    // No stale Saturday error from a previous form session.
    setDateError('')

    // Open the form pre-filled with this event.
    setShowForm(true)

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
    setCurrentEventId('')
    // Clear the Saturday error along with the form.
    setDateError('')
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

      {/* Section title. */}
      <div className="event-management-list-header">
        <h2>רשימת אירועים</h2>
      </div>

      {/* Free-text search (name / location / group / status / date) +
          collapsible advanced filters (status, assigned group). */}
      <div className="event-management-filters">
        <SearchFilters
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder="🔍 חיפוש לפי שם, מיקום, קבוצה או סטטוס..."
          fields={eventFilterFields}
          values={filters}
          onChange={updateFilter}
          onClear={clearFilters}
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
            filteredEvents.map((eventItem) => {
              const isExpanded = expandedEventId === eventItem.id
              const detailsId = `event-card-details-${eventItem.id}`

              return (
              <article className={`event-card ${isExpanded ? 'is-expanded' : ''}`} key={eventItem.id}>

                {/* Card header: name + status badge. */}
                <button
                  type="button"
                  className="event-card-head"
                  onClick={() => setExpandedEventId((currentId) => (currentId === eventItem.id ? null : eventItem.id))}
                  aria-expanded={isExpanded}
                  aria-controls={detailsId}
                >
                  <h3 className="event-card-name">{eventItem.name}</h3>
                  <span
                    className={`event-management-status ${statusClass(computeEventStatus(eventItem))}`}
                  >
                    {computeEventStatus(eventItem)}
                  </span>
                  <span className="event-card-chevron" aria-hidden="true" />
                </button>

                {/* Key details (label + value rows). */}
                <dl className="event-card-details" id={detailsId}>
                  {eventItem.imageUrls && eventItem.imageUrls.length > 0 && (
                    <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '8px', borderBottom: '1px dashed var(--border)' }}>
                      {eventItem.imageUrls.map((url, idx) => (
                        <img 
                          key={idx} 
                          src={url} 
                          alt={`תמונה ${idx + 1}`} 
                          style={{ 
                            width: '50px', 
                            height: '50px', 
                            objectFit: 'cover', 
                            borderRadius: '6px', 
                            border: '1px solid var(--border)',
                            flexShrink: 0
                          }} 
                        />
                      ))}
                    </div>
                  )}
                  <div className="event-card-row">
                    <dt>תאריך</dt>
                    <dd>{formatDateOnlyForDisplay(eventItem.date, { fallback: '—' })}</dd>
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

                {/* Actions. Admins manage with edit/delete only (the card
                    already shows the details); read-only viewers keep the
                    "פרטים" button — it's their only way into an event. */}
                <div className="event-management-row-actions event-card-actions">
                  {readOnly ? (
                    <>
                      {eventItem.imageUrls && eventItem.imageUrls.length > 0 && (
                        <button type="button" onClick={() => setViewingPicturesEvent(eventItem)}>
                          תמונות
                        </button>
                      )}
                      <button type="button" onClick={() => handleOpenDetails(eventItem)}>
                        פרטים
                      </button>
                    </>
                  ) : (
                    <>
                      {/* One organized window with everything (details + images),
                          replacing the old images-only button. */}
                      <button type="button" onClick={() => setViewingDetailsEvent(eventItem)}>
                        פרטים
                      </button>

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
              )
            })
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

          {/* Opens the add-event form (the list is the default view). */}
          {!readOnly && !showForm && (
            <button
              type="button"
              className="event-management-primary-btn"
              onClick={handleOpenAddForm}
            >
              + הוספת אירוע
            </button>
          )}
        </header>

        {/* Error banner shown if the events failed to load. */}
        {error && (
          <div className="event-management-error">
            שגיאה בטעינת אירועים מ־Firebase: {error}
          </div>
        )}

        {/* Add / edit event — opens in a modal window, matching the other
            management screens (volunteers / guides) so it looks uniform. */}
        {!readOnly && showForm && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-content" style={{ maxWidth: '700px' }}>

            {/* Title changes between add and edit mode. */}
            <div className="modal-header">
              {isEditing ? 'עריכת אירוע' : 'הוספת אירוע חדש'}
            </div>

            {/* `volunteer-form` is the shared modal-form layout (a vertical
                stack). The inner grid keeps the fields in two compact columns,
                exactly like the volunteers modal. */}
            <form className="volunteer-form" onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>

                {/* Event name. */}
                <div className="form-group">
                  <label>שם האירוע</label>
                  <input
                    className="styled-input full-width-input"
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="לדוגמה: יום ספורט קהילתי"
                  />
                </div>

                {/* Event date (custom picker). */}
                <div className="form-group">
                  <BirthDatePicker
                    key={editingEventId ?? `new-${formResetKey}`}
                    value={form.date}
                    onChange={(date) => {
                      setForm((currentForm) => ({ ...currentForm, date }))
                      // Keep the value visible, but flag a Saturday selection.
                      setDateError(isSaturdayDateValue(date) ? 'לא ניתן לקבוע אירוע ליום שבת.' : '')
                    }}
                    label="תאריך"
                    pastYears={3}
                    futureYears={6}
                  />
                  {dateError && (
                    <div className="event-management-error">{dateError}</div>
                  )}
                </div>

                {/* Location. */}
                <div className="form-group">
                  <label>מיקום</label>
                  <input
                    className="styled-input full-width-input"
                    type="text"
                    name="location"
                    value={form.location}
                    onChange={handleChange}
                    placeholder="לדוגמה: מרכז שלווה, ירושלים"
                  />
                </div>

                {/* Assigned group dropdown. */}
                <div className="form-group">
                  <label>שיוך קבוצה</label>
                  <select
                    className="styled-input full-width-input"
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
                </div>

                {/* Status dropdown. */}
                <div className="form-group">
                  <label>סטטוס</label>
                  <select
                    className="styled-input full-width-input"
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
                </div>

                {/* Contact name. */}
                <div className="form-group">
                  <label>איש קשר</label>
                  <input
                    className="styled-input full-width-input"
                    type="text"
                    name="contactName"
                    value={form.contactName}
                    onChange={handleChange}
                    placeholder="שם איש קשר"
                  />
                </div>

                {/* Contact phone. */}
                <div className="form-group">
                  <label>טלפון איש קשר</label>
                  <input
                    className="styled-input full-width-input"
                    type="tel"
                    name="contactPhone"
                    value={form.contactPhone}
                    onChange={handleChange}
                    placeholder="050-0000000"
                    dir="ltr"
                  />
                </div>

                {/* Contact email. */}
                <div className="form-group">
                  <label>אימייל איש קשר</label>
                  <input
                    className="styled-input full-width-input"
                    type="email"
                    name="contactEmail"
                    value={form.contactEmail}
                    onChange={handleChange}
                    placeholder="name@example.com"
                    dir="ltr"
                  />
                </div>

                {/* Full-width description field. */}
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>תיאור האירוע</label>
                  <textarea
                    className="styled-input full-width-input"
                    name="description"
                    value={form.description}
                    onChange={handleChange}
                    placeholder="כתוב תיאור קצר של האירוע"
                    rows="4"
                  />
                </div>

                {/* Event images. */}
                <div style={{ gridColumn: '1 / -1', marginTop: '10px' }}>
                  <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px' }}>תמונות האירוע</label>

                  {/* List of uploaded images */}
                  {form.imageUrls && form.imageUrls.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '10px', marginBottom: '12px' }}>
                      {form.imageUrls.map((url, idx) => (
                        <div key={idx} style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)', height: '90px' }}>
                          <img src={url} alt={`תמונה ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          <button
                            type="button"
                            onClick={() => handleRemoveImage(idx)}
                            style={{
                              position: 'absolute',
                              top: '4px',
                              left: '4px',
                              background: 'rgba(239, 68, 68, 0.9)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '50%',
                              width: '22px',
                              height: '22px',
                              padding: '0',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              fontSize: '11px',
                              boxShadow: 'none'
                            }}
                            title="הסרת תמונה"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* File Upload Input Button */}
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    padding: '12px',
                    border: '2px dashed var(--brand-500)',
                    borderRadius: '12px',
                    cursor: uploading ? 'default' : 'pointer',
                    background: 'var(--surface-2)',
                    opacity: uploading ? 0.7 : 1,
                    transition: 'background 0.2s',
                    textAlign: 'center',
                    margin: '0'
                  }}>
                    <input
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleImageUpload}
                      disabled={uploading}
                      style={{ display: 'none' }}
                    />
                    <span style={{ fontWeight: '700', color: 'var(--brand-700)', fontSize: '14px' }}>
                      🖼️ {uploading ? 'מעלה תמונות...' : 'הוספת תמונות מהמכשיר'}
                    </span>
                  </label>
                  <small style={{ display: 'block', marginTop: '4px', color: 'var(--text-soft)', fontSize: '12px' }}>
                    JPG / PNG / WEBP · עד ‎5MB לתמונה
                  </small>
                </div>
              </div>

              {/* Cancel (closes the modal) + submit — same order and style as
                  the other modals. */}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    handleCancelEdit()
                    setShowForm(false)
                  }}
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="btn btn-success"
                  disabled={saving}
                >
                  {getSubmitButtonText({ saving, isEditing })}
                </button>
              </div>
            </form>
          </div>
        </div>
        )}

        {/* The events list is the screen's main view, for everyone. */}
        {eventListSection}
      </section>

      {/* Pictures preview modal */}
      {viewingPicturesEvent && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setViewingPicturesEvent(null)}>
          <div className="modal-content" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>תמונות של {viewingPicturesEvent.name}</span>
              <button 
                type="button" 
                onClick={() => setViewingPicturesEvent(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text)',
                  fontSize: '20px',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  boxShadow: 'none'
                }}
              >
                ✕
              </button>
            </div>
            
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', 
              gap: '12px', 
              maxHeight: '60vh', 
              overflowY: 'auto', 
              padding: '10px 0' 
            }}>
              {viewingPicturesEvent.imageUrls && viewingPicturesEvent.imageUrls.map((url, idx) => (
                <a 
                  key={idx} 
                  href={url} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  style={{ 
                    borderRadius: '8px', 
                    overflow: 'hidden', 
                    border: '1px solid var(--border)', 
                    display: 'block', 
                    height: '110px',
                    position: 'relative'
                  }}
                >
                  <img 
                    src={url} 
                    alt={`תמונה ${idx + 1}`} 
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
            
            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn btn-outline" onClick={() => setViewingPicturesEvent(null)}>
                סגור
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full event details modal — an organized, read-only view of everything
          on one event: status, image gallery, key fields, contact, description. */}
      {viewingDetailsEvent && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setViewingDetailsEvent(null)}>
          <div className="modal-content event-details-modal" onClick={(e) => e.stopPropagation()}>

            {/* Header: event name + derived status badge + close button. */}
            <div className="event-details-head">
              <div className="event-details-title-wrap">
                <h3 className="event-details-title">{viewingDetailsEvent.name}</h3>
                <span className={`event-management-status ${statusClass(computeEventStatus(viewingDetailsEvent))}`}>
                  {computeEventStatus(viewingDetailsEvent)}
                </span>
              </div>
              <button
                type="button"
                className="event-details-close"
                aria-label="סגירת פרטי האירוע"
                onClick={() => setViewingDetailsEvent(null)}
              >
                ✕
              </button>
            </div>

            {/* Image gallery — only shown when the event actually has images.
                Each thumbnail opens the full image in a new tab. */}
            {viewingDetailsEvent.imageUrls && viewingDetailsEvent.imageUrls.length > 0 && (
              <div className="event-details-gallery">
                {viewingDetailsEvent.imageUrls.map((url, idx) => (
                  <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="event-details-thumb">
                    <img src={url} alt={`תמונה ${idx + 1}`} />
                  </a>
                ))}
              </div>
            )}

            {/* The fields, as label/value pairs. Missing values show a dash. */}
            <dl className="event-details-grid">
              <div className="event-details-row">
                <dt>תאריך</dt>
                <dd>{formatDateOnlyForDisplay(viewingDetailsEvent.date, { fallback: '—' })}</dd>
              </div>
              <div className="event-details-row">
                <dt>מיקום</dt>
                <dd>{viewingDetailsEvent.location || '—'}</dd>
              </div>
              <div className="event-details-row">
                <dt>קבוצה משויכת</dt>
                <dd>{viewingDetailsEvent.assignedGroup || '—'}</dd>
              </div>
              <div className="event-details-row">
                <dt>איש קשר</dt>
                <dd>{viewingDetailsEvent.contact?.name || '—'}</dd>
              </div>
              <div className="event-details-row">
                <dt>טלפון</dt>
                <dd dir="ltr">{viewingDetailsEvent.contact?.phone || '—'}</dd>
              </div>
              <div className="event-details-row">
                <dt>אימייל</dt>
                <dd dir="ltr">{viewingDetailsEvent.contact?.email || '—'}</dd>
              </div>
              <div className="event-details-row event-details-row--full">
                <dt>תיאור</dt>
                <dd>{viewingDetailsEvent.description || '—'}</dd>
              </div>
            </dl>

            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn btn-outline" onClick={() => setViewingDetailsEvent(null)}>
                סגור
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
