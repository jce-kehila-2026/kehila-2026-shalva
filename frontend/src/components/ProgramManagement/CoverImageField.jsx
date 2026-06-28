// CoverImageField — a friendly "pick an image" control used by the program
// create and edit modals. It hides the plain (ugly) native file input behind a
// styled drop-zone label, previews the chosen image, and offers a remove
// action. The actual upload happens in the parent, which knows the program id.

function CoverImageField({ label, imageUrl, uploading, onSelect, onRemove }) {
  return (
    <div className="form-group">
      <label>{label}</label>

      {/* Preview of the current / just-uploaded image. */}
      {imageUrl && (
        <div className="cover-field-preview">
          <img src={imageUrl} alt="תצוגה מקדימה של התמונה" />
        </div>
      )}

      {/* The whole box is a <label>, so a click anywhere opens the file dialog.
          The input is hidden VISUALLY (not display:none) — some mobile browsers
          refuse to open the picker for a display:none input. */}
      <label className={`cover-field-drop${uploading ? ' is-uploading' : ''}`}>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onSelect}
          disabled={uploading}
          className="cover-field-input"
        />

        {/* Icon on the right, caption + hint stacked beside it (compact row). */}
        <span className="cover-field-icon" aria-hidden="true">🖼️</span>

        <span className="cover-field-labeltext">
          <span className="cover-field-text">
            {uploading
              ? 'מעלה תמונה...'
              : imageUrl
                ? 'החלפת תמונה'
                : 'בחירת תמונה מהמכשיר'}
          </span>
          <span className="cover-field-hint">JPG / PNG / WEBP · עד ‎5MB</span>
        </span>
      </label>

      {/* Remove the chosen image (applied when the form is saved). */}
      {imageUrl && !uploading && (
        <button type="button" className="cover-field-remove" onClick={onRemove}>
          הסרת תמונה
        </button>
      )}
    </div>
  );
}

export default CoverImageField;
