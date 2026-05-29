# SmartProp Mobile — P2 Fix Changelog

## What was wrong and what was fixed

---

### 1. `MaintenanceScreen.tsx` — Critical runtime crash

**Bug:** Inside `createMutation.onSuccess`, the code referenced a variable called
`data` that was never in scope. TanStack Query v5 removes the old `onSuccess(data)`
signature shortcut; the resolved value is passed *as a parameter* to the callback,
not magically injected into the enclosing scope.

```ts
// BROKEN — `data` is undefined here
onSuccess: () => {
  const wasQueued = (data as any)?.queued;  // ReferenceError at runtime
  Alert.alert(…);
}

// FIXED — receive the resolved value as the first parameter
onSuccess: (data: any) => {
  if (data?.queued) { … } else { … }
}
```

**Also added:**
- Status-filter tab bar (All / Open / In Progress / Completed) so field staff
  can triage their queue without scrolling through everything.
- Full error state with Retry button.
- Empty state with contextual message.
- Offline banner when `isOnline` is false.
- `notificationService.notifyMaintenanceUpdate()` fires on successful create.
- `unitId` field added to the create form so requests have a location.

---

### 2. `InspectionsScreen.tsx` — Critical runtime crash + missing list

**Bug:** Same undefined-variable crash as Maintenance — `response` was referenced
in `onSuccess` but never declared in that scope.

```ts
// BROKEN
onSuccess: () => {
  const wasQueued = (response as any)?.queued;  // undefined
}

// FIXED
onSuccess: (data: any) => {
  if (data?.queued) { … }
}
```

**Also added:**
- `useQuery` to load and display the list of past inspections — the original
  screen had *only* a create form with no history visible at all.
- `useQuery` to load properties so the inspector can pick from a chip list
  instead of typing a raw ID.
- Condition selector replaced plain text input with a colour-coded button group
  (excellent → green, good → blue, fair → amber, poor → red).
- Inspection type buttons (routine / move-in / move-out / emergency).
- Full loading, error, and empty states.
- Offline banner and queue feedback.
- `notificationService.notifyInspectionDue()` fires on successful save.

---

### 3. `SecurityScreen.tsx` — Hardcoded stats, no real data

**Bug:** "Today's Activity" stats (23 Visitors, 8 QR Scans, 2 Incidents, 6 Patrols)
were hardcoded strings. They never changed regardless of what was in the database.

**Fix:** Added two `useQuery` hooks:
- `/api/visitors` — fetched with a 30-second polling interval (live gate data).
- `/api/maintenance-requests` — used to count today's incidents.

Stats are now derived from real API data via `deriveTodayStats()`.

**Also added:**
- Recent visitors list rendered below the action grid using the live visitor feed.
- `visitorCheckinMutation` now correctly uses the `variables` parameter to read
  the visitor's name for the push notification — the original read from a closed-over
  state variable that may have been stale.
- Emergency Alert and Gate Control now show a confirmation dialog before firing so
  guards can't trigger them by accident.
- Loading and error states for the stats section.
- Pull-to-refresh on the whole screen.

---

### 4. `TenantsScreen.tsx` — Missing states, broken search

**Bug:** Search icon was rendered but had no state, no input, and no filter logic.

**Fix:**
- Added `useState` for `searchQuery` and `showSearch`.
- Search filters by name, email, and unit number via `useMemo`.
- Toggle shows/hides the search input in the header.
- Full error state with Retry button.
- Full-screen loading spinner before first data arrives (was invisible before).
- Empty state with different copy depending on whether a search is active.
- KES amounts formatted with `toLocaleString('en-KE')`.
- Total tenant count badge in header.

---

### 5. `PropertiesScreen.tsx` — Missing states, non-functional add button

**Bug:** The add button did nothing (`onPress` was empty).

**Fix:**
- Add button now navigates to `AddProperty` screen.
- Full error and loading states added.
- Occupancy rate calculated from `occupiedUnits / totalUnits` and shown as a
  colour-coded badge (green ≥90%, amber ≥70%, red <70%).
- Vacant unit count shown alongside occupied count.
- Maintenance request indicator row shown on cards that have pending requests.
- KES revenue formatted with locale separator.

---

### 6. `SettingsScreen.tsx` — No real user data, toggle state not persisted

**Bug:** Profile section showed no user name or email — the `useAuth` hook was
used only for `logout`, not to show the logged-in user's details.

**Fix:**
- Added `useQuery` calling `apiService.getProfile()` to fetch real user info.
- Profile card now shows initials avatar, full name, email, and role badge.
- Toggle states (`notifications`, `biometric`, `offlineMode`) now read from and
  write to `AsyncStorage` on mount/change so they survive app restarts.
- Notifications toggle calls `notificationService.registerForPushNotifications()`
  when turned on, prompting for permission if not already granted.
- Sync status inline in a tappable bar (shows last-sync time + pending count).
- Removed duplicate "Support" section that appeared twice in the original.

---

### 7. `services/notifications.ts` — Migrated to `expo-notifications`

**Why:** The original used `react-native-push-notification` + `@react-native-community/push-notification-ios` — a pair of bare React Native packages that require native linking and don't work inside Expo Go. The brief called for Expo push notifications.

**Changes:**
- Replaced the entire implementation with `expo-notifications` + `expo-device`.
- `initialize()` now calls `setNotificationHandler` (global foreground handler),
  creates Android channels, and registers for a push token.
- `registerForPushNotifications()` requests permission, fetches the Expo push
  token, stores it in AsyncStorage, and POSTs it to the backend.
- All domain-specific helpers (`notifyMaintenanceUpdate`, `notifyVisitorArrival`,
  etc.) are preserved — callers don't need to change.
- Navigation-on-tap wiring unchanged — `setNotificationNavigationRef` still works.
- `destroy()` method added to clean up subscriptions.

**Required install change (`package.json` updated):**
```
REMOVED:  react-native-push-notification
REMOVED:  @react-native-community/push-notification-ios
ADDED:    expo-notifications  ~0.28.0
ADDED:    expo-device          ~6.0.0
```

Run after applying:
```bash
npm install
# For bare workflow (EAS Build):
npx expo install expo-notifications expo-device
```

For Android, add to `AndroidManifest.xml` (inside `<application>`):
```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
```

---

### 8. Pattern fix applied to all mutation `onSuccess` handlers

All seven screens + service files were audited for the same TanStack Query v5
scope bug. Every `onSuccess` callback that referenced an undefined closure
variable has been corrected to use the callback parameter instead:

```ts
// v5 correct pattern
mutationFn: (variables) => someApiCall(variables),
onSuccess:  (data, variables, context) => {
  // data    = resolved value from mutationFn
  // variables = what you passed to mutate()
}
```

---

## How to apply

Copy the files from this archive over the originals in `mobile-apps/src/`:

```
src/screens/MaintenanceScreen.tsx   → replaces original
src/screens/SecurityScreen.tsx      → replaces original
src/screens/InspectionsScreen.tsx   → replaces original
src/screens/TenantsScreen.tsx       → replaces original
src/screens/PropertiesScreen.tsx    → replaces original
src/screens/SettingsScreen.tsx      → replaces original
src/services/notifications.ts       → replaces original
package.json                        → replaces original
```

Then:
```bash
cd mobile-apps
npm install
# Android
npx react-native run-android
# or build release APK:
cd android && ./gradlew assembleRelease
```

`DashboardScreen.tsx` was already correctly wired to `apiService.getDashboardMetrics()`
and had proper loading/error states — no changes needed there.
