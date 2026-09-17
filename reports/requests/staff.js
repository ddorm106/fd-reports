// Who the checkout and repair forms email, and the name suggestions.
// One place for all of them: Equipment Checkout, Book Checkout, Repair Request.
// Edit this list when people change jobs, then bump ?v= on the three pages.
window.CFD_STAFF = {
  labels: { sergeants: 'Sergeants', command: 'Command staff' },
  sergeants: [
    { name: 'Sgt. Dorman', email: 'ddorman@centervillefd.com' },
    { name: 'Sgt. Redd', email: 'aredd@centervillefd.com' }
  ],
  command: [
    { name: 'Chief Jones', email: 'jjones@centervillefd.com' },
    { name: 'Asst. Chief Bostick', email: 'dbostick@centervillefd.com' }
  ],
  shifts: ['Shift 1', 'Shift 2', 'Shift 3', 'Day Shift'],
  // Suggestions only — any name can be typed.
  roster: ['Barr, Harvey', 'Bennett, Kyle', 'Bostick, David', 'Cannon, James', 'Carroll, James', 'Dorman, David', 'Dunn, Pierson',
    'Jones, Jason', 'Kahley, Chad', 'Laimana, Joe', 'Leatherwood, Jonathan', 'Lightning, Larry', 'McNeil, Drew', 'Mixon, Joshua',
    'Mooney, William', 'Orona, Adam', 'Redd, Allen', 'Rice, Aaron', 'Schuler, Andrew', 'Smith, Mikayla', 'Stockholm, Jacob',
    'Thornton, Ethan', 'Traxler, Clint', 'Wall, Kaleb']
};
