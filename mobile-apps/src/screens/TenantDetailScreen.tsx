import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { apiService, ApiResponse } from '../services/api';

// Define the Tenant interface based on the shared schema
interface Tenant {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  idNumber?: string; // Not in schema, but kept for UI if it exists in data
  status: string;
}

const TenantDetailScreen = ({ route }: any) => {
  const { tenantId } = route.params;

  const { data: tenantResponse, isLoading } = useQuery<ApiResponse<Tenant>>({
    queryKey: ['tenant', tenantId],
    queryFn: async () => {
      const response = await apiService.getTenant(tenantId);
      return response as ApiResponse<Tenant>;
    },
  });

  const tenant = tenantResponse?.data;

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <Text>Loading tenant details...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{tenant?.firstName} {tenant?.lastName}</Text>
        <Text style={styles.subtitle}>{tenant?.email}</Text>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Contact Information</Text>
        <Text>Phone: {tenant?.phone || 'N/A'}</Text>
        {tenant?.idNumber && <Text>ID Number: {tenant.idNumber}</Text>}
        <Text>Status: {tenant?.status || 'N/A'}</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 20, backgroundColor: '#10B981' },
  title: { fontSize: 24, fontWeight: 'bold', color: 'white' },
  subtitle: { fontSize: 16, color: '#E5E7EB' },
  section: { padding: 20, backgroundColor: 'white', margin: 16, borderRadius: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 10 },
});

export default TenantDetailScreen;
