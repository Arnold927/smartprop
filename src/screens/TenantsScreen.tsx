/**
 * TenantsScreen.tsx — FIXED
 *
 * Gaps fixed vs original:
 *  1. No error state — added retry UI.
 *  2. No empty state — added empty list message.
 *  3. Search was wired to an icon but had no input/logic — added functional search.
 *  4. Loading indicator shown as full-screen spinner before first data arrives
 *     (was only shown in the RefreshControl which is invisible until you pull).
 *  5. KES amounts formatted with toLocaleString for Kenyan locale.
 */

import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, TextInput, ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { apiService } from '../services/api';

const formatKES = (amount: number | string | undefined) => {
  const n = Number(amount ?? 0);
  return isNaN(n) ? '0' : n.toLocaleString('en-KE');
};

const TenantsScreen = ({ navigation }: any) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch]   = useState(false);

  const {
    data: rawTenants,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['tenants'],
    queryFn: async () => {
      const response = await apiService.getTenants();
      if (!response.success) throw new Error(response.error ?? 'Failed to load tenants');
      const payload = response.data as any;
      return Array.isArray(payload) ? payload : (payload?.tenants ?? payload?.data ?? []);
    },
  });

  const tenants = useMemo(() => {
    const all: any[] = rawTenants ?? [];
    if (!searchQuery.trim()) return all;
    const q = searchQuery.toLowerCase();
    return all.filter((t: any) =>
      `${t.firstName ?? ''} ${t.lastName ?? ''}`.toLowerCase().includes(q) ||
      (t.email ?? '').toLowerCase().includes(q) ||
      String(t.unitNumber ?? '').toLowerCase().includes(q),
    );
  }, [rawTenants, searchQuery]);

  const renderTenant = ({ item }: any) => {
    const initials = `${(item.firstName ?? '?')[0]}${(item.lastName ?? '?')[0]}`.toUpperCase();
    const isActive = (item.leaseStatus ?? 'active') === 'active';

    return (
      <TouchableOpacity
        style={styles.tenantCard}
        onPress={() => navigation.navigate('TenantDetail', { tenantId: item.id })}
        activeOpacity={0.7}
      >
        <View style={styles.tenantHeader}>
          <View style={[styles.avatar, { backgroundColor: isActive ? '#3B82F6' : '#9CA3AF' }]}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.tenantInfo}>
            <Text style={styles.tenantName}>{item.firstName} {item.lastName}</Text>
            <Text style={styles.tenantUnit}>Unit {item.unitNumber ?? 'N/A'}</Text>
            <Text style={styles.tenantContact} numberOfLines={1}>{item.email}</Text>
          </View>
          <View style={[
            styles.statusBadge,
            { backgroundColor: isActive ? '#10B981' : '#6B7280' },
          ]}>
            <Text style={styles.statusText}>
              {(item.leaseStatus ?? 'active').replace('_', ' ')}
            </Text>
          </View>
        </View>

        <View style={styles.tenantStats}>
          <View style={styles.stat}>
            <Icon name="payments" size={15} color="#3B82F6" />
            <Text style={styles.statLabel}>Rent</Text>
            <Text style={styles.statValue}>KES {formatKES(item.monthlyRent)}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Icon name="date-range" size={15} color="#10B981" />
            <Text style={styles.statLabel}>Lease Ends</Text>
            <Text style={styles.statValue}>
              {item.leaseEndDate
                ? new Date(item.leaseEndDate).toLocaleDateString('en-KE')
                : 'N/A'}
            </Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Icon name="build" size={15} color="#F59E0B" />
            <Text style={styles.statLabel}>Requests</Text>
            <Text style={styles.statValue}>{item.maintenanceRequests ?? 0}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Icon name="people" size={48} color="#D1D5DB" />
      <Text style={styles.emptyTitle}>
        {searchQuery ? 'No tenants match your search' : 'No tenants yet'}
      </Text>
      <Text style={styles.emptySubtitle}>
        {searchQuery
          ? 'Try a different name, email, or unit number.'
          : 'Tenants added via the web platform will appear here.'}
      </Text>
    </View>
  );

  const renderError = () => (
    <View style={styles.emptyContainer}>
      <Icon name="cloud-off" size={48} color="#EF4444" />
      <Text style={styles.emptyTitle}>Failed to load tenants</Text>
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
        {showSearch ? (
          <View style={styles.searchContainer}>
            <Icon name="search" size={20} color="rgba(255,255,255,0.7)" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Name, email or unit…"
              placeholderTextColor="rgba(255,255,255,0.6)"
              autoFocus
              returnKeyType="search"
            />
            <TouchableOpacity onPress={() => { setShowSearch(false); setSearchQuery(''); }}>
              <Icon name="close" size={20} color="rgba(255,255,255,0.9)" />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.title}>Tenants</Text>
            <View style={styles.headerActions}>
              {(rawTenants?.length ?? 0) > 0 && (
                <Text style={styles.countBadge}>{rawTenants!.length}</Text>
              )}
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => setShowSearch(true)}
              >
                <Icon name="search" size={24} color="white" />
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {/* Content */}
      {isLoading && !rawTenants ? (
        <View style={styles.centred}>
          <ActivityIndicator size="large" color="#10B981" />
          <Text style={styles.loadingText}>Loading tenants…</Text>
        </View>
      ) : isError ? (
        renderError()
      ) : (
        <FlatList
          data={tenants}
          renderItem={renderTenant}
          keyExtractor={(item) => String(item.id)}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#10B981" />
          }
          contentContainerStyle={[
            styles.listContainer,
            tenants.length === 0 && styles.listContainerEmpty,
          ]}
          ListEmptyComponent={renderEmpty}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, paddingTop: 50, backgroundColor: '#10B981',
    minHeight: 90,
  },
  title: { fontSize: 24, fontWeight: 'bold', color: 'white' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  countBadge: {
    backgroundColor: 'rgba(255,255,255,0.25)', color: 'white',
    fontSize: 13, fontWeight: '700', paddingHorizontal: 8,
    paddingVertical: 3, borderRadius: 12,
  },
  iconButton: {
    backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, padding: 8,
  },
  searchContainer: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 10, paddingHorizontal: 12,
  },
  searchInput: { flex: 1, color: 'white', fontSize: 15, paddingVertical: 8 },

  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  loadingText: { marginTop: 12, color: '#6B7280', fontSize: 14 },
  emptyContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, marginTop: 60,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#374151', marginTop: 16 },
  emptySubtitle: { fontSize: 14, color: '#6B7280', marginTop: 8, textAlign: 'center' },
  retryButton: {
    marginTop: 16, backgroundColor: '#10B981', paddingHorizontal: 24,
    paddingVertical: 10, borderRadius: 8,
  },
  retryText: { color: 'white', fontWeight: '600', fontSize: 14 },

  listContainer: { padding: 16 },
  listContainerEmpty: { flexGrow: 1 },

  tenantCard: {
    backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 3,
  },
  tenantHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: 'white', fontSize: 17, fontWeight: 'bold' },
  tenantInfo: { flex: 1, marginLeft: 12 },
  tenantName: { fontSize: 16, fontWeight: '600', color: '#1F2937' },
  tenantUnit: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  tenantContact: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  statusText: {
    fontSize: 11, color: 'white', fontWeight: '700', textTransform: 'capitalize',
  },
  tenantStats: {
    flexDirection: 'row', justifyContent: 'space-around',
    borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingTop: 14,
  },
  stat: { alignItems: 'center', flex: 1 },
  statDivider: { width: 1, backgroundColor: '#F3F4F6' },
  statLabel: { fontSize: 11, color: '#6B7280', marginTop: 4 },
  statValue: { fontSize: 13, fontWeight: '600', color: '#1F2937', marginTop: 2 },
});

export default TenantsScreen;
