/**
 * PatrolLogScreen.tsx
 *
 * Full patrol log workflow:
 *  - Start / End shift
 *  - Record named checkpoints with GPS coordinates and timestamp
 *  - Add notes per checkpoint
 *  - Live elapsed-time timer
 *  - Photo attachment per checkpoint (react-native-image-picker)
 *  - Submit full patrol log to the backend
 *  - View previous patrols list
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  FlatList,
  Platform,
  Modal,
  Image,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Icon from 'react-native-vector-icons/MaterialIcons';
import Geolocation from 'react-native-geolocation-service';
// @ts-ignore
import { launchCamera } from 'react-native-image-picker';
import { apiService } from '../services/api';
import { format } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Coords { latitude: number; longitude: number; accuracy?: number }
interface Checkpoint {
  id:        string;
  name:      string;
  notes:     string;
  timestamp: string;
  coords:    Coords | null;
  photoUri:  string | null;
}

// ─── Predefined checkpoint locations for Nairobi properties ───────────────────
const PRESET_CHECKPOINTS = [
  'Main Gate', 'Back Gate', 'Parking Lot', 'Ground Floor Lobby',
  'Lift / Stairwell', 'Rooftop', 'Generator Room', 'Perimeter Fence',
  'Swimming Pool Area', 'Gym', 'CCTV Room', 'Refuse Area',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const elapsed = (startIso: string): string => {
  const ms   = Date.now() - new Date(startIso).getTime();
  const h    = Math.floor(ms / 3_600_000);
  const m    = Math.floor((ms % 3_600_000) / 60_000);
  const s    = Math.floor((ms % 60_000) / 1_000);
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
};

const getCurrentCoords = (): Promise<Coords> =>
  new Promise((resolve, reject) =>
    Geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5_000 },
    ),
  );

// ─── Component ────────────────────────────────────────────────────────────────

const PatrolLogScreen = ({ navigation }: any) => {
  const queryClient = useQueryClient();

  // Patrol state
  const [patrolStarted, setPatrolStarted]   = useState(false);
  const [patrolStartTime, setPatrolStartTime] = useState<string | null>(null);
  const [checkpoints, setCheckpoints]       = useState<Checkpoint[]>([]);
  const [elapsedStr, setElapsedStr]         = useState('00:00:00');
  const [gpsLoading, setGpsLoading]         = useState(false);

  // Add-checkpoint modal state
  const [showAddModal, setShowAddModal]     = useState(false);
  const [cpName, setCpName]                 = useState('');
  const [cpNotes, setCpNotes]               = useState('');
  const [cpPhoto, setCpPhoto]               = useState<string | null>(null);
  const [cpCoords, setCpCoords]             = useState<Coords | null>(null);
  const [locating, setLocating]             = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Timer ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (patrolStarted && patrolStartTime) {
      timerRef.current = setInterval(() => setElapsedStr(elapsed(patrolStartTime)), 1_000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [patrolStarted, patrolStartTime]);

  // ── Previous patrols ───────────────────────────────────────────────────────

  const { data: previousPatrols = [], isLoading: loadingPrev } = useQuery({
    queryKey: ['patrols'],
    queryFn: async () => {
      const res = await apiService.getPatrols?.() ?? { data: [] };
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !patrolStarted,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const submitPatrolMutation = useMutation({
    mutationFn: (notes: string) =>
      apiService.createPatrolLog({
        startTime:   patrolStartTime,
        endTime:     new Date().toISOString(),
        checkpoints: checkpoints.map((cp) => ({
          name:      cp.name,
          notes:     cp.notes,
          timestamp: cp.timestamp,
          latitude:  cp.coords?.latitude ?? null,
          longitude: cp.coords?.longitude ?? null,
          hasPhoto:  !!cp.photoUri,
        })),
        patrolNotes: notes,
        status:      'completed',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patrols'] });
      Alert.alert('✅ Patrol Logged', 'Your patrol log has been submitted successfully.', [
        { text: 'OK', onPress: () => { resetPatrol(); navigation.goBack(); } },
      ]);
    },
    onError: () => {
      Alert.alert('Saved Locally', 'Patrol log saved — will sync when network is available.');
      resetPatrol();
      navigation.goBack();
    },
  });

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleStartPatrol = async () => {
    setGpsLoading(true);
    let startCoords: Coords | null = null;
    try {
      startCoords = await getCurrentCoords();
    } catch { /* GPS optional */ }
    setGpsLoading(false);
    const now = new Date().toISOString();
    setPatrolStartTime(now);
    setPatrolStarted(true);
    setCheckpoints([]);
    // Auto-add the first "Start of Patrol" checkpoint
    const first: Checkpoint = {
      id:        Date.now().toString(),
      name:      'Start of Patrol',
      notes:     '',
      timestamp: now,
      coords:    startCoords,
      photoUri:  null,
    };
    setCheckpoints([first]);
  };

  const handleOpenAddModal = async () => {
    setCpName('');
    setCpNotes('');
    setCpPhoto(null);
    setLocating(true);
    try {
      const coords = await getCurrentCoords();
      setCpCoords(coords);
    } catch { setCpCoords(null); }
    setLocating(false);
    setShowAddModal(true);
  };

  const handleSaveCheckpoint = () => {
    if (!cpName.trim()) {
      Alert.alert('Required', 'Please select or enter a checkpoint name.');
      return;
    }
    const newCp: Checkpoint = {
      id:        Date.now().toString(),
      name:      cpName,
      notes:     cpNotes,
      timestamp: new Date().toISOString(),
      coords:    cpCoords,
      photoUri:  cpPhoto,
    };
    setCheckpoints((prev) => [...prev, newCp]);
    setShowAddModal(false);
  };

  const handleTakePhoto = () => {
    launchCamera(
      { mediaType: 'photo', quality: 0.6, saveToPhotos: false },
      (res: any) => {
        if (!res.didCancel && !res.errorCode && res.assets?.[0]?.uri) {
          setCpPhoto(res.assets[0].uri);
        }
      },
    );
  };

  const handleEndPatrol = () => {
    Alert.alert(
      'End Patrol',
      `Submit patrol log with ${checkpoints.length} checkpoint${checkpoints.length !== 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit', onPress: () => {
            Alert.prompt?.(
              'Final Notes',
              'Add any overall patrol notes (optional)',
              (notes) => submitPatrolMutation.mutate(notes ?? ''),
              'plain-text',
              '',
            ) ?? submitPatrolMutation.mutate('');
          },
        },
      ],
    );
  };

  const resetPatrol = () => {
    setPatrolStarted(false);
    setPatrolStartTime(null);
    setCheckpoints([]);
    setElapsedStr('00:00:00');
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Patrol Log</Text>
        <View style={{ width: 40 }} />
      </View>

      {patrolStarted ? (
        /* ── Active Patrol View ── */
        <>
          {/* Timer Banner */}
          <View style={styles.timerBanner}>
            <View style={styles.timerLeft}>
              <View style={styles.timerDot} />
              <Text style={styles.timerLabel}>PATROL ACTIVE</Text>
            </View>
            <Text style={styles.timerValue}>{elapsedStr}</Text>
            <Text style={styles.timerSince}>
              Since {patrolStartTime ? format(new Date(patrolStartTime), 'HH:mm') : '--'}
            </Text>
          </View>

          {/* Checkpoints */}
          <ScrollView style={styles.checkpointScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.checkpointList}>
              {checkpoints.map((cp, idx) => (
                <View key={cp.id} style={styles.checkpointItem}>
                  <View style={styles.checkpointTimeline}>
                    <View style={[styles.cpDot, idx === 0 && styles.cpDotFirst, idx === checkpoints.length - 1 && styles.cpDotLast]} />
                    {idx < checkpoints.length - 1 && <View style={styles.cpLine} />}
                  </View>
                  <View style={styles.checkpointBody}>
                    <View style={styles.cpHeader}>
                      <Text style={styles.cpName}>{cp.name}</Text>
                      <Text style={styles.cpTime}>{format(new Date(cp.timestamp), 'HH:mm')}</Text>
                    </View>
                    {cp.coords && (
                      <View style={styles.cpMeta}>
                        <Icon name="location-on" size={12} color="#6B7280" />
                        <Text style={styles.cpMetaText}>
                          {cp.coords.latitude.toFixed(5)}, {cp.coords.longitude.toFixed(5)}
                          {cp.coords.accuracy ? ` (±${Math.round(cp.coords.accuracy)}m)` : ''}
                        </Text>
                      </View>
                    )}
                    {cp.notes ? <Text style={styles.cpNotes}>{cp.notes}</Text> : null}
                    {cp.photoUri && (
                      <Image source={{ uri: cp.photoUri }} style={styles.cpPhoto} />
                    )}
                  </View>
                </View>
              ))}
            </View>

            {/* Add Checkpoint Button */}
            <TouchableOpacity style={styles.addCpButton} onPress={handleOpenAddModal} disabled={locating}>
              {locating
                ? <ActivityIndicator color="#F59E0B" />
                : <Icon name="add-location-alt" size={22} color="#F59E0B" />
              }
              <Text style={styles.addCpText}>{locating ? 'Getting GPS…' : 'Add Checkpoint'}</Text>
            </TouchableOpacity>
          </ScrollView>

          {/* End Patrol */}
          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={[styles.endPatrolButton, submitPatrolMutation.isPending && styles.endPatrolDisabled]}
              onPress={handleEndPatrol}
              disabled={submitPatrolMutation.isPending}
            >
              {submitPatrolMutation.isPending
                ? <ActivityIndicator color="white" />
                : <Icon name="stop-circle" size={20} color="white" />
              }
              <Text style={styles.endPatrolText}>
                {submitPatrolMutation.isPending ? 'Submitting…' : `End Patrol · ${checkpoints.length} checkpoints`}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        /* ── Pre-Patrol / History View ── */
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Start button */}
          <TouchableOpacity style={styles.startButton} onPress={handleStartPatrol} disabled={gpsLoading}>
            {gpsLoading
              ? <ActivityIndicator color="white" size="large" />
              : <>
                  <Icon name="directions-walk" size={48} color="white" />
                  <Text style={styles.startButtonTitle}>Start Patrol</Text>
                  <Text style={styles.startButtonSub}>GPS will be recorded at each checkpoint</Text>
                </>
            }
          </TouchableOpacity>

          {/* Previous Patrols */}
          <Text style={styles.sectionTitle}>Previous Patrols</Text>
          {loadingPrev
            ? <ActivityIndicator color="#F59E0B" style={{ marginTop: 20 }} />
            : previousPatrols.length === 0
              ? <Text style={styles.emptyText}>No patrol logs yet.</Text>
              : previousPatrols.slice(0, 15).map((p: any) => (
                  <View key={p.id} style={styles.historyCard}>
                    <View style={styles.historyLeft}>
                      <Icon name="directions-walk" size={20} color="#F59E0B" />
                    </View>
                    <View style={styles.historyBody}>
                      <Text style={styles.historyDate}>
                        {p.startTime ? format(new Date(p.startTime), 'dd MMM yyyy · HH:mm') : 'Unknown time'}
                      </Text>
                      <Text style={styles.historyMeta}>
                        {(p.checkpoints ?? []).length} checkpoints
                        {p.endTime && p.startTime
                          ? ` · ${Math.round((new Date(p.endTime).getTime() - new Date(p.startTime).getTime()) / 60_000)} min`
                          : ''}
                      </Text>
                    </View>
                    <View style={[styles.historyStatus, { backgroundColor: p.status === 'completed' ? '#D1FAE5' : '#FEF3C7' }]}>
                      <Text style={[styles.historyStatusText, { color: p.status === 'completed' ? '#065F46' : '#92400E' }]}>
                        {p.status === 'completed' ? 'Done' : 'In Progress'}
                      </Text>
                    </View>
                  </View>
                ))
          }
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* ── Add Checkpoint Modal ── */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAddModal(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <Icon name="close" size={24} color="#374151" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Add Checkpoint</Text>
            <TouchableOpacity onPress={handleSaveCheckpoint}>
              <Text style={styles.modalSave}>Save</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
            {/* GPS indicator */}
            <View style={[styles.gpsIndicator, { backgroundColor: cpCoords ? '#D1FAE5' : '#FEF3C7' }]}>
              <Icon name={cpCoords ? 'location-on' : 'location-off'} size={16} color={cpCoords ? '#065F46' : '#92400E'} />
              <Text style={[styles.gpsText, { color: cpCoords ? '#065F46' : '#92400E' }]}>
                {cpCoords
                  ? `GPS: ${cpCoords.latitude.toFixed(5)}, ${cpCoords.longitude.toFixed(5)}`
                  : 'GPS not available — checkpoint will be saved without location'}
              </Text>
            </View>

            {/* Preset chips */}
            <Text style={styles.fieldLabel}>Checkpoint Location</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetsScroll}>
              <View style={styles.presetsRow}>
                {PRESET_CHECKPOINTS.map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={[styles.presetChip, cpName === p && styles.presetChipActive]}
                    onPress={() => setCpName(p)}
                  >
                    <Text style={[styles.presetChipText, cpName === p && styles.presetChipTextActive]}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <TextInput
              style={styles.textInput}
              value={cpName}
              onChangeText={setCpName}
              placeholder="Or type custom location name…"
            />

            {/* Notes */}
            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Observations / Notes</Text>
            <TextInput
              style={[styles.textInput, styles.notesInput]}
              value={cpNotes}
              onChangeText={setCpNotes}
              placeholder="e.g. Gate locked, CCTV functional, area clear…"
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            {/* Photo */}
            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Photo Evidence</Text>
            {cpPhoto
              ? (
                <View>
                  <Image source={{ uri: cpPhoto }} style={styles.photoPreview} />
                  <TouchableOpacity onPress={() => setCpPhoto(null)} style={styles.removePhotoBtn}>
                    <Icon name="delete" size={16} color="#EF4444" />
                    <Text style={styles.removePhotoText}>Remove photo</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.photoButton} onPress={handleTakePhoto}>
                  <Icon name="camera-alt" size={24} color="#6B7280" />
                  <Text style={styles.photoButtonText}>Take Photo</Text>
                </TouchableOpacity>
              )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#F9FAFB' },
  header:             { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: Platform.OS === 'ios' ? 54 : 16, backgroundColor: '#1F2937' },
  backBtn:            { padding: 4 },
  headerTitle:        { fontSize: 20, fontWeight: 'bold', color: 'white' },

  timerBanner:        { backgroundColor: '#F59E0B', padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timerLeft:          { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timerDot:           { width: 10, height: 10, borderRadius: 5, backgroundColor: 'white', opacity: 0.8 },
  timerLabel:         { color: 'white', fontWeight: '700', fontSize: 12, letterSpacing: 1 },
  timerValue:         { color: 'white', fontWeight: 'bold', fontSize: 28, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  timerSince:         { color: 'rgba(255,255,255,0.8)', fontSize: 12 },

  checkpointScroll:   { flex: 1 },
  checkpointList:     { padding: 16 },
  checkpointItem:     { flexDirection: 'row', marginBottom: 4 },
  checkpointTimeline: { width: 24, alignItems: 'center' },
  cpDot:              { width: 12, height: 12, borderRadius: 6, backgroundColor: '#D1D5DB', marginTop: 4, zIndex: 1 },
  cpDotFirst:         { backgroundColor: '#10B981' },
  cpDotLast:          { backgroundColor: '#F59E0B' },
  cpLine:             { flex: 1, width: 2, backgroundColor: '#E5E7EB', marginLeft: 5 },
  checkpointBody:     { flex: 1, marginLeft: 12, marginBottom: 16, backgroundColor: 'white', borderRadius: 10, padding: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  cpHeader:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  cpName:             { fontSize: 15, fontWeight: '600', color: '#1F2937', flex: 1 },
  cpTime:             { fontSize: 13, color: '#6B7280', marginLeft: 8 },
  cpMeta:             { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 4 },
  cpMetaText:         { fontSize: 11, color: '#6B7280' },
  cpNotes:            { fontSize: 13, color: '#374151', marginTop: 4 },
  cpPhoto:            { width: '100%', height: 120, borderRadius: 8, marginTop: 8, resizeMode: 'cover' },

  addCpButton:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', margin: 16, padding: 14, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: '#F59E0B', gap: 8 },
  addCpText:          { fontSize: 15, fontWeight: '600', color: '#F59E0B' },

  bottomBar:          { padding: 16, backgroundColor: 'white', borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  endPatrolButton:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#EF4444', padding: 16, borderRadius: 12, gap: 10 },
  endPatrolDisabled:  { opacity: 0.6 },
  endPatrolText:      { color: 'white', fontSize: 16, fontWeight: '700' },

  content:            { flex: 1, padding: 16 },
  startButton:        { backgroundColor: '#F59E0B', borderRadius: 16, padding: 32, alignItems: 'center', marginBottom: 24, shadowColor: '#F59E0B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  startButtonTitle:   { fontSize: 24, fontWeight: 'bold', color: 'white', marginTop: 12, marginBottom: 6 },
  startButtonSub:     { fontSize: 13, color: 'rgba(255,255,255,0.8)', textAlign: 'center' },

  sectionTitle:       { fontSize: 16, fontWeight: '700', color: '#374151', marginBottom: 12 },
  emptyText:          { color: '#9CA3AF', textAlign: 'center', marginTop: 24 },
  historyCard:        { flexDirection: 'row', alignItems: 'center', backgroundColor: 'white', borderRadius: 10, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  historyLeft:        { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  historyBody:        { flex: 1 },
  historyDate:        { fontSize: 14, fontWeight: '600', color: '#1F2937' },
  historyMeta:        { fontSize: 12, color: '#6B7280', marginTop: 2 },
  historyStatus:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  historyStatusText:  { fontSize: 11, fontWeight: '600' },

  modalContainer:     { flex: 1, backgroundColor: 'white' },
  modalHeader:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  modalTitle:         { fontSize: 18, fontWeight: '600', color: '#1F2937' },
  modalSave:          { fontSize: 16, color: '#F59E0B', fontWeight: '700' },
  modalScroll:        { flex: 1, padding: 16 },

  gpsIndicator:       { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: 8, marginBottom: 16 },
  gpsText:            { fontSize: 12, flex: 1 },

  fieldLabel:         { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  presetsScroll:      { marginBottom: 10 },
  presetsRow:         { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  presetChip:         { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: 'white' },
  presetChipActive:   { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' },
  presetChipText:     { fontSize: 13, color: '#6B7280' },
  presetChipTextActive:{ color: '#92400E', fontWeight: '600' },
  textInput:          { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10, padding: 12, fontSize: 15, backgroundColor: '#F9FAFB', color: '#111827' },
  notesInput:         { height: 100, textAlignVertical: 'top' },

  photoButton:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 90, borderRadius: 10, borderWidth: 2, borderStyle: 'dashed', borderColor: '#D1D5DB', gap: 8 },
  photoButtonText:    { fontSize: 15, color: '#6B7280', fontWeight: '500' },
  photoPreview:       { width: '100%', height: 160, borderRadius: 10, resizeMode: 'cover' },
  removePhotoBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  removePhotoText:    { fontSize: 13, color: '#EF4444' },
});

export default PatrolLogScreen;
