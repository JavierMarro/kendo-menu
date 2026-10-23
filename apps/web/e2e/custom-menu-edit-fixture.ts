export const CUSTOM_EDIT_ENTRY_ID = 'custom-edit-entry';
export const CUSTOM_EDIT_NAME = 'Evening practice';
export const CUSTOM_EDIT_NOTES = 'Keep the shoulders relaxed.';
export const BUILT_IN_EDIT_ENTRY_ID = 'custom-edit-built-in';

export const CUSTOM_EDIT_DASHBOARD = {
  version: 10,
  state: {
    dashboardEntries: [
      {
        id: CUSTOM_EDIT_ENTRY_ID,
        trainingSetId: 'custom-edit-menu',
        trainingSet: {
          id: 'custom-edit-menu',
          name: CUSTOM_EDIT_NAME,
          description: 'A short solo session.',
          category: 'custom',
          customIntensity: 'intense-drill',
          isBuiltIn: false,
          sections: [
            {
              id: 'custom-edit-footwork',
              name: 'Footwork',
              exercises: [
                {
                  id: 'custom-edit-suburi',
                  name: 'Suburi',
                  quantities: { repetitions: 10 },
                  notes: 'Keep wrists soft.',
                },
                {
                  id: 'custom-edit-jigeiko',
                  name: 'Jigeiko',
                  quantities: { duration: { unit: 'seconds', value: 30 } },
                },
              ],
            },
            {
              id: 'custom-edit-cooldown',
              name: 'Cool-down',
              exercises: [
                {
                  id: 'custom-edit-stretch',
                  name: 'Stretch',
                  quantities: { duration: { unit: 'minutes', value: 5 } },
                },
              ],
            },
          ],
        },
        quantityOverrides: {
          'custom-edit-suburi': { repetitions: 24 },
          'custom-edit-jigeiko': { seconds: 45 },
          'custom-edit-stretch': { minutes: 7 },
        },
        activityNotes: {},
        notes: CUSTOM_EDIT_NOTES,
        createdAt: '2026-10-22T12:00:00.000Z',
      },
      {
        id: BUILT_IN_EDIT_ENTRY_ID,
        trainingSetId: 'international-dojo-2-hour-session',
        quantityOverrides: {},
        activityNotes: {},
        notes: '',
        createdAt: '2026-10-22T12:00:00.000Z',
      },
    ],
  },
};
