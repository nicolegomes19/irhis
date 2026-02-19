import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { PatientDetails } from '../types';

/** DB accepts only 'male' | 'female' */
const SEX_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
] as const;

interface PatientDetailsCardProps {
  details: PatientDetails;
  onUpdateDetails: (details: Partial<PatientDetails>) => void;
  isEditable: boolean;
}

const DetailItem: React.FC<{
  label: string;
  value: string | number;
  unit?: string;
  isEditingValue: any;
  isEditing: boolean;
  onChangeText?: (text: string) => void;
  keyboardType?: 'default' | 'numeric';
  colors: Record<string, string>;
}> = ({ label, value, unit = '', isEditingValue, isEditing, onChangeText, keyboardType = 'default', colors }) => (
  <View style={styles.detailItem}>
    <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
    {isEditing && onChangeText ? (
      <TextInput
        style={[styles.value, styles.input, { color: colors.text, borderBottomColor: colors.border }]}
        value={isEditingValue === 0 || !isEditingValue ? '' : String(isEditingValue)}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
      />
    ) : (
      <Text style={[styles.value, { color: colors.text }]}>{value}{unit}</Text>
    )}
  </View>
);

const PatientDetailsCard: React.FC<PatientDetailsCardProps> = ({ details, onUpdateDetails, isEditable }) => {
  const { colors } = useTheme();
  const [isEditing, setIsEditing] = useState(false);
  const [editableDetails, setEditableDetails] = useState<any>(details);
  const [showSexPicker, setShowSexPicker] = useState(false);

  useEffect(() => {
    setEditableDetails({
      ...details,
      // Store height in cm for editing (API returns meters)
      height: details.height && details.height > 0 ? details.height * 100 : '',
    });
  }, [details]);


    const updateField = useCallback((field: keyof PatientDetails, value: any) => {
        setEditableDetails((prev: any) => {
            let val = (value !== null && value !== undefined) ? String(value) : '';
            
            if (field === 'age') {
                val = val.replace(/[^0-9]/g, ''); 
            } else if (field === 'weight' || field === 'height') {
                val = val.replace(',', '.');
            }

            const nextState = { ...prev, [field]: val };

            const weight = parseFloat(String(nextState.weight || 0));
            const height = parseFloat(String(nextState.height || 0));
            if (weight > 0 && height > 0) {
                const hM = height / 100;
                nextState.bmi = weight / (hM * hM);
            }

            return nextState;
        });
    }, []);

  const handleSave = () => {
        const age = parseInt(String(editableDetails.age), 10) || 0;
        const weight = parseFloat(String(editableDetails.weight)) || 0;
        const heightCm = parseFloat(String(editableDetails.height)) || 0;
        const height = heightCm > 0 ? heightCm / 100 : 0; // API expects meters
        const bmi = Number(editableDetails.bmi) || 0;
        const finalData: Partial<PatientDetails> = {
            ...editableDetails,
            age,
            weight,
            height,
            bmi,
        };

        onUpdateDetails(finalData);
        setIsEditing(false);
    };

  const handleCancel = () => {
    setEditableDetails(details);
    setIsEditing(false);
  };

  const displayBmi = (val: any) => {
    const num = parseFloat(String(val));
    return num > 0 ? num.toFixed(1) : '—';
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Patient Details</Text>
        {isEditable && !isEditing && (
          <TouchableOpacity onPress={() => setIsEditing(true)}>
            <Ionicons name="pencil" size={24} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.detailsGrid}>
        <DetailItem
            label="Age"
            value={details.age || '—'}
            isEditingValue={editableDetails.age}
            isEditing={isEditing}
            onChangeText={(text) => updateField('age', text)}
            keyboardType="numeric"
            colors={colors}
        />
        <View style={styles.detailItem}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Sex</Text>
          {isEditing ? (
            <TouchableOpacity
                            style={[styles.value, styles.sexButton, { color: colors.text, borderBottomColor: colors.border }]}
              onPress={() => setShowSexPicker(true)}
            >
              <Text style={[styles.value, { color: colors.text }]}>
                                {SEX_OPTIONS.find(o => o.value === (editableDetails.sex || '').toLowerCase())?.label ?? (editableDetails.sex || 'Select...')}
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : (
            <Text style={[styles.value, { color: colors.text }]}>
              {SEX_OPTIONS.find(o => o.value === (details.sex || '').toLowerCase())?.label ?? (details.sex || '—')}
            </Text>
          )}
        </View>
        <DetailItem
            label="Height"
            value={details.height && details.height > 0 ? details.height * 100 : '—'}
            unit=" cm"
            isEditingValue={editableDetails.height}
            isEditing={isEditing}
            onChangeText={(text) => updateField('height', text)}
            keyboardType="numeric"
            colors={colors}
        />
        <DetailItem
          label="Weight"
          value={details.weight || '—'}
          unit=" kg"
          isEditingValue={editableDetails.weight}
          isEditing={isEditing}
          onChangeText={(text) => updateField('weight', text)}
          keyboardType="numeric"
          colors={colors}
        />
        <DetailItem
          label="BMI"
          value={displayBmi(isEditing ? editableDetails.bmi : details.bmi)}
          isEditingValue={""}
          isEditing={false}
          colors={colors}
        />
      </View>

      {isEditing ? (
        <>
          <Text style={[styles.label, { color: colors.text, marginTop: 16 }]}>Other Clinical Info</Text>
          <TextInput
            style={[styles.textInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.mediumGray }]}
            value={editableDetails.clinicalInfo}
            onChangeText={(text) => updateField('clinicalInfo', text)}
            multiline
            placeholder="Add info..."
            placeholderTextColor={colors.textSecondary}
          />
          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={handleCancel}>
              <Text style={[styles.buttonText, { color: colors.text }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary }]} onPress={handleSave}>
              <Text style={[styles.buttonText, { color: colors.white }]}>Save Changes</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <View style={styles.infoSection}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Other Clinical Info</Text>
          <Text style={[styles.value, { color: colors.text }]}>{details.clinicalInfo || '—'}</Text>
        </View>
      )}

      <Modal visible={showSexPicker} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowSexPicker(false)}>
          <View style={[styles.sexPickerModal, { backgroundColor: colors.card }]}>
            <Text style={[styles.sexPickerTitle, { color: colors.text }]}>Select Sex</Text>
            {SEX_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.sexPickerOption, { borderBottomColor: colors.border }]}
                onPress={() => {
                  updateField('sex', opt.value);
                  setShowSexPicker(false);
                }}
              >
                <Text style={[styles.sexPickerOptionText, { color: colors.text }]}>{opt.label}</Text>
                {(editableDetails.sex || '').toLowerCase() === opt.value && (
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
    card: {
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
    },
    detailsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
    },
    detailItem: {
        width: '48%',
        marginBottom: 16,
    },
    label: {
        fontSize: 14,
        marginBottom: 4,
    },
    value: {
        fontSize: 16,
        fontWeight: '500',
    },
    input: {
        borderBottomWidth: 1,
        paddingBottom: 4,
    },
    sexButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
        paddingBottom: 4,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    sexPickerModal: {
        width: '100%',
        maxWidth: 280,
        borderRadius: 12,
        padding: 20,
    },
    sexPickerTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 16,
        textAlign: 'center',
    },
    sexPickerOption: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    sexPickerOptionText: {
        fontSize: 16,
        fontWeight: '500',
    },
    infoSection: {
        marginTop: 16,
    },
    textInput: {
        minHeight: 100,
        textAlignVertical: 'top',
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        fontSize: 16,
        marginTop: 8,
    },
    buttonRow: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 16,
        gap: 12,
    },
    button: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 8,
    },
    buttonText: {
        fontWeight: '600',
    },
    cancelButton: {
        backgroundColor: 'transparent',
    },
});

export default PatientDetailsCard; 