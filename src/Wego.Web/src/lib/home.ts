/**
 * A click on the logo: back to the start (Mein Plan, else the plan of the construction phase) at today. The
 * page shown already goes to today on this event; a page opened anew starts there anyway.
 */
export const HOME_EVENT = 'wego:home'

export const goHome = () => window.dispatchEvent(new Event(HOME_EVENT))
