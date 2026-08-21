import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, Linking,
} from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Application from 'expo-application';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius } from '../theme';
import APP_CONFIG from '../config/appConfig';
import { OemInfo } from '../utils/oemBattery';

type Props = {
  visible: boolean;
  oem: OemInfo;
  onDone: () => void;
};

export default function BatteryWizardModal({ visible, oem, onDone }: Props) {
  const [openedSettings, setOpenedSettings] = useState(false);

  const openAppSettings = async () => {
    setOpenedSettings(true);
    try {
      await IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
        { data: `package:${Application.applicationId}` }
      );
    } catch {
      try {
        await Linking.openSettings();
      } catch {}
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onDone}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={[styles.iconWrap, { backgroundColor: APP_CONFIG.appColor }]}>
              <Ionicons name="battery-half" size={26} color="#FFFFFF" />
            </View>
            <Text style={styles.title}>Para no perderte llamadas</Text>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.intro}>
              Tu teléfono ({oem.manufacturer}) cierra apps en segundo plano de forma
              agresiva. Con estos pasos (una sola vez) te asegurás de recibir las
              llamadas aunque la app esté cerrada:
            </Text>

            {oem.instructions.map((block, i) => (
              <View key={i} style={styles.block}>
                <Text style={styles.blockTitle}>
                  {i + 1}. {block.title}
                </Text>
                {block.steps.map((step, j) => (
                  <View key={j} style={styles.stepRow}>
                    <View style={styles.bullet} />
                    <Text style={styles.stepText}>{step}</Text>
                  </View>
                ))}
              </View>
            ))}

            <TouchableOpacity style={styles.settingsBtn} onPress={openAppSettings}>
              <Ionicons name="settings-outline" size={18} color="#FFFFFF" />
              <Text style={styles.settingsBtnText}>Abrir ajustes de la app</Text>
            </TouchableOpacity>
            {openedSettings && (
              <Text style={styles.hint}>
                Volvé a la app cuando termines los pasos.
              </Text>
            )}
          </ScrollView>

          <TouchableOpacity style={styles.doneBtn} onPress={onDone}>
            <Text style={styles.doneBtnText}>Listo, ya lo configuré</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: BorderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  intro: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  block: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  blockTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 6,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 4,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: APP_CONFIG.appColor,
    marginTop: 7,
    marginRight: 8,
  },
  stepText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  settingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: APP_CONFIG.appColor,
    borderRadius: BorderRadius.md,
    paddingVertical: 12,
    marginTop: Spacing.sm,
    gap: 8,
  },
  settingsBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  hint: {
    textAlign: 'center',
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 8,
  },
  doneBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: Spacing.sm,
  },
  doneBtnText: {
    color: APP_CONFIG.appColor,
    fontWeight: '700',
    fontSize: 15,
  },
});
