import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { apiService, ApiResponse } from '../services/api';

// Define the Property interface based on the shared schema
interface Property {
  id: number;
  name: string;
  address: string;
  totalUnits: number;
  imageUrl?: string | null;
  description?: string | null;
  status?: string;
  type?: string;
}

const PropertyDetailScreen = ({ route }: any) => {
  const { propertyId } = route.params;

  const { data: propertyResponse, isLoading } = useQuery<ApiResponse<Property>>({
    queryKey: ['property', propertyId],
    queryFn: async () => {
      const response = await apiService.getProperty(propertyId);
      return response as ApiResponse<Property>;
    },
  });

  const property = propertyResponse?.data;

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <Text>Loading property details...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{property?.name || 'Property Details'}</Text>
        <Text style={styles.subtitle}>{property?.address}</Text>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Details</Text>
        <Text>Type: {property?.type || 'N/A'}</Text>
        <Text>Units: {property?.totalUnits || 0}</Text>
        <Text>Status: {property?.status || 'N/A'}</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 20, backgroundColor: '#3B82F6' },
  title: { fontSize: 24, fontWeight: 'bold', color: 'white' },
  subtitle: { fontSize: 16, color: '#E5E7EB' },
  section: { padding: 20, backgroundColor: 'white', margin: 16, borderRadius: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 10 },
});

export default PropertyDetailScreen;
