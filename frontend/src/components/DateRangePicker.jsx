import React from 'react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'

/**
 * DateRangePicker — start/end datetime pickers (local timezone).
 * Stores Date objects in parent state.
 */
export default function DateRangePicker({ startDate, endDate, onStartChange, onEndChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <label style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
        From:
      </label>
      <DatePicker
        selected={startDate}
        onChange={onStartChange}
        selectsStart
        startDate={startDate}
        endDate={endDate}
        showTimeSelect
        timeFormat="HH:mm"
        timeIntervals={60}
        dateFormat="yyyy-MM-dd HH:mm"
        placeholderText="Start date"
        maxDate={endDate || undefined}
        customInput={
          <input
            style={{ width: 160, fontSize: 12 }}
            aria-label="Start date"
          />
        }
      />
      <label style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
        To:
      </label>
      <DatePicker
        selected={endDate}
        onChange={onEndChange}
        selectsEnd
        startDate={startDate}
        endDate={endDate}
        showTimeSelect
        timeFormat="HH:mm"
        timeIntervals={60}
        dateFormat="yyyy-MM-dd HH:mm"
        placeholderText="End date"
        minDate={startDate || undefined}
        customInput={
          <input
            style={{ width: 160, fontSize: 12 }}
            aria-label="End date"
          />
        }
      />
    </div>
  )
}
