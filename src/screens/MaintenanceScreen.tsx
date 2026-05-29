/**
 * MaintenanceScreen.tsx — FIXED
 *
 * Bugs fixed vs original:
 *  1. onSuccess referenced `data` which was never in scope — replaced with
 *     the `variables` parameter that TanStack Query v5 passes to onSuccess.
 *  2. Added proper error state with retry button.
 *  3. Added empty state when the list is genuinely empty.
 *  4. Added status-filter tab bar (All / Open / In Progress / Completed)
 *     so field staff can quickly see their queue.
 *  5. Push notification fired on successful create via notificationService.
 *  6. Offline-queue success message now correctly reads from mutation result.
 */

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, Modal, TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { apiService } from '../services/api';
import { useSync } from '../services/sync';
import { notificationService } from '../services/notifications';

const STATUS_FILTERS = [
  { label: 'All',         value: '' },
  { label: 'Open',        value: 'open' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Completed',   value: 'completed' },
];

const MaintenanceScreen = ({ navigation }: any) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeFilter, setActiveFilter] = useState('');
  const [newRequest, setNewRequest] = useState({
    title: '', description: '', priority: 'medium', unitId: '',
  });

  const queryClient = useQueryClient();
  const { isOnline, queueOfflineAction } = useSync();

  const {
    data: requests,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['maintenance-requests', activeFilter],
    queryFn: async () => {
      const response = await apiService.getMaintenanceRequests(
        activeFilter ? { status: activeFilter } : undefined,
      );
      if (!response.success) throw new Error(response.error ?? 'Failed to load');
      // API may return array directly or wrapped in { data: [] }
      const payload = response.data as any;
      return Array.isArray(payload) ? payload : (payload?.requests ?? payload?.data ?? []);
    },
  });

  const createMutation = useMutation({
    mutationFn: async (requestData: any) => {
      if (!isOnline) {
        await queueOfflineAction('maintenance_request', requestData);
        return { success: true, queued: true };
      }
      const res = await apiService.createMaintenanceRequest(requestData);
      if (!res.success) throw new Error(res.error ?? 'Failed to create request');
      return res;
    },
    // FIX: use `data` parameter (the resolved value) not a closure variable
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-requests'] });
      setShowCreateModal(false);
      setNewRequest({ title: '', description: '', priority: 'medium', unitId: '' });

      if (data?.queued) {
        Alert.alert('Queued', 'Request saved — will sync automatically when online.');
      } else {
        Alert.alert('Success', 'Maintenance request created successfully.');
        // Trigger local notification so the field team gets feedback
        notificationService.notifyMaintenanceUpdate(
          data?.data?.id ?? '—',
          'open',
          newRequest.title,
        );
      }
    },
    onError: (err: any) =>
      Alert.alert('Error', err?.message ?? 'Failed to create maintenance request'),
  });

  const handleCreateRequest = () => {
    if (!newRequest.title.trim() || !newRequest.description.trim()) {
      Alert.alert('Validation', 'Please fill in Title and Description.');
      return;
    }
    createMutation.mutate(newRequest);
  };

  const getPriorityColor = (priority: string) => {
    const map: Record<string, string> = {
      urgent: '#EF4444', high: '#F59E0B', medium: '#3B82F6', low: '#10B981',
    };
    return map[priority] ?? '#6B7280';
  };

  const getStatusColor = (status: string) => {
    const map: Record<string, string> = {
      completed: '#10B981', in_progress: '#F59E0B', open: '#3B82F6',
    };
    return map[status] ?? '#6B7280';
  };

  const renderRequest = ({ item }: any) => (
    <TouchableOpacity
      style={styles.requestCard}
      onPress={() => navigation.navigate('MaintenanceDetail', { requestId: item.id })}
      activeOpacity={0.7}
    >
      <View style={styles.requestHeader}>
        <View style={styles.requestInfo}>
          <Text style={styles.requestTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.requestUnit}>
            Unit {item.unitNumber ?? item.unit?.number ?? 'N/A'}
          </Text>
        </View>
        <View style={[styles.priorityBadge, { backgroundColor: getPriorityColor(item.priority) }]}>
          <Text style={styles.priorityText}>{item.priority?.toUpperCase()}</Text>
        </View>
      </View>

      <Text style={styles.requestDescription} numberOfLines={2}>
        {item.description}
      </Text>

      <View style={styles.requestFooter}>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
          <Text style={styles.statusText}>
            {(item.status ?? '').replace('_', ' ')}
          </Text>
        </View>
        <Text style={styles.requestDate}>
          {item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-KE') : '—'}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Icon name="build" size={48} color="#D1D5DB" />
      <Text style={styles.emptyTitle}>No requests found</Text>
      <Text style={styles.emptySubtitle}>
        {activeFilter
          ? `No ${activeFilter.replace('_', ' ')} requests at the moment.`
          : 'Tap + to log a new maintenance request.'}
      </Text>
    </View>
  );

  const renderError = () => (
    <View style={styles.emptyContainer}>
      <Icon name="cloud-off" size={48} color="#EF4444" />
      <Text style={styles.emptyTitle}>Failed to load</Text>
      <Text style={styles.emptySubtitle}>Check your connection and try again.</Text>
      <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
        <Text style={styles.retryText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Maintenance</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => setShowCreateModal(true)}
          accessibilityLabel="New maintenance request"
        >
          <Icon name="add" size={24} color="white" />
        </TouchableOpacity>
      </View>

      {/* Status filter tabs */}
      <View style={styles.filterBar}>
        {STATUS_FILTERS.map(f => (
          <TouchableOpacity
            key={f.value}
            style={[styles.filterTab, activeFilter === f.value && styles.filterTabActive]}
            onPress={() => setActiveFilter(f.value)}
          >
            <Text style={[
              styles.filterTabText,
              activeFilter === f.value && styles.filterTabTextActive,
            ]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Offline banner */}
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Icon name="cloud-off" size={14} color="white" />
          <Text style={styles.offlineText}>Offline — new requests will sync when connected</Text>
        </View>
      )}

      {/* Content */}
      {isLoading ? (
        <View style={styles.centred}>
          <ActivityIndicator size="large" color="#F59E0B" />
          <Text style={styles.loadingText}>Loading requests…</Text>
        </View>
      ) : isError ? (
        renderError()
      ) : (
        <FlatList
          data={requests ?? []}
          renderItem={renderRequest}
          keyExtractor={(item) => String(item.id)}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#F59E0B" />
          }
          contentContainerStyle={[
            styles.listContainer,
            (!requests || requests.length === 0) && styles.listContainerEmpty,
          ]}
          ListEmptyComponent={renderEmpty}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Create Modal */}
      <Modal visible={showCreateModal} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowCreateModal(false)}>
              <Icon name="close" size={24} color="#374151" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>New Maintenance Request</Text>
            <TouchableOpacity
              onPress={handleCreateRequest}
              disabled={createMutation.isPending}
            >
              <Text style={[
                styles.saveButton,
                createMutation.isPending && styles.saveButtonDisabled,
              ]}>
                {createMutation.isPending ? 'Saving…' : 'Save'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.modalContent}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Title *</Text>
              <TextInput
                style={styles.textInput}
                value={newRequest.title}
                onChangeText={(text) => setNewRequest({ ...newRequest, title: text })}
                placeholder="Brief description of the issue"
                placeholderTextColor="#9CA3AF"
                returnKeyType="next"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Unit / Location</Text>
              <TextInput
                style={styles.textInput}
                value={newRequest.unitId}
                onChangeText={(text) => setNewRequest({ ...newRequest, unitId: text })}
                placeholder="e.g. A-12 or Gate House"
                placeholderTextColor="#9CA3AF"
                returnKeyType="next"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Description *</Text>
              <TextInput
                style={[styles.textInput, styles.textArea]}
                value={newRequest.description}
                onChangeText={(text) => setNewRequest({ ...newRequest, description: text })}
                placeholder="Detailed description of the maintenance issue"
                placeholderTextColor="#9CA3AF"
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Priority</Text>
              <View style={styles.priorityButtons}>
                {(['low', 'medium', 'high', 'urgent'] as const).map((priority) => (
                  <TouchableOpacity
                    key={priority}
                    style={[
                      styles.priorityButton,
                      { borderColor: getPriorityColor(priority) },
                      newRequest.priority === priority && {
                        backgroundColor: getPriorityColor(priority) + '20',
                      },
                    ]}
                    onPress={() => setNewRequest({ ...newRequest, priority })}
                  >
                    <Text style={[
                      styles.priorityButtonText,
                      newRequest.priority === priority && {
                        color: getPriorityColor(priority),
                        fontWeight: '700',
                      },
                    ]}>
                      {priority}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },

  // Header
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, paddingTop: 50, backgroundColor: '#F59E0B',
  },
  title: { fontSize: 24, fontWeight: 'bold', color: 'white' },
  addButton: {
    backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 20, padding: 8,
  },

  // Filter bar
  filterBar: {
    flexDirection: 'row', backgroundColor: 'white',
    borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  filterTab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  filterTabActive: { borderBottomWidth: 2, borderBottomColor: '#F59E0B' },
  filterTabText: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  filterTabTextActive: { color: '#F59E0B', fontWeight: '700' },

  // Offline
  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#6B7280', paddingVertical: 6, gap: 6,
  },
  offlineText: { color: 'white', fontSize: 12 },

  // States
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  loadingText: { marginTop: 12, color: '#6B7280', fontSize: 14 },
  emptyContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, marginTop: 60,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#374151', marginTop: 16 },
  emptySubtitle: { fontSize: 14, color: '#6B7280', marginTop: 8, textAlign: 'center' },
  retryButton: {
    marginTop: 16, backgroundColor: '#F59E0B', paddingHorizontal: 24,
    paddingVertical: 10, borderRadius: 8,
  },
  retryText: { color: 'white', fontWeight: '600', fontSize: 14 },

  // List
  listContainer: { padding: 16 },
  listContainerEmpty: { flexGrow: 1 },

  // Cards
  requestCard: {
    backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 3,
  },
  requestHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 8,
  },
  requestInfo: { flex: 1, marginRight: 8 },
  requestTitle: { fontSize: 16, fontWeight: '600', color: '#1F2937' },
  requestUnit: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  priorityText: { fontSize: 11, color: 'white', fontWeight: '700' },
  requestDescription: { fontSize: 14, color: '#6B7280', marginBottom: 12, lineHeight: 20 },
  requestFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusText: {
    fontSize: 12, color: 'white', fontWeight: '600', textTransform: 'capitalize',
  },
  requestDate: { fontSize: 12, color: '#9CA3AF' },

  // Modal
  modalContainer: { flex: 1, backgroundColor: 'white' },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  modalTitle: { fontSize: 18, fontWeight: '600', color: '#1F2937' },
  saveButton: { fontSize: 16, color: '#F59E0B', fontWeight: '700' },
  saveButtonDisabled: { opacity: 0.4 },
  modalContent: { flex: 1, padding: 20 },
  inputGroup: { marginBottom: 24 },
  inputLabel: { fontSize: 15, fontWeight: '600', color: '#374151', marginBottom: 8 },
  textInput: {
    borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12,
    fontSize: 15, backgroundColor: '#F9FAFB', color: '#1F2937',
  },
  textArea: { height: 110, textAlignVertical: 'top' },
  priorityButtons: { flexDirection: 'row', gap: 10 },
  priorityButton: {
    flex: 1, borderWidth: 2, borderRadius: 8, paddingVertical: 10,
    alignItems: 'center',
  },
  priorityButtonText: {
    fontSize: 13, fontWeight: '600', color: '#6B7280', textTransform: 'capitalize',
  },
});

export default MaintenanceScreen;
