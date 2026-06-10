/**
 * Open App Studio — built-in block implementations.
 * Generated into your project by @oas/codegen; edit freely, it's your code now.
 * Self-contained: React Native primitives only, themed via ../theme/tokens.
 */
import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  Image as RNImage,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput as RNTextInput,
  View,
} from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';

export interface Item {
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
  amount?: string;
  value?: boolean;
}

type Handler = () => void;

/* ── Navigation ─────────────────────────────────────────────── */

export function NavHeader({ title, showBack = true, onBack }: { title: string; showBack?: boolean; onBack?: Handler }) {
  return (
    <View style={s.navHeader}>
      {showBack && (
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={s.navBack}>‹</Text>
        </Pressable>
      )}
      <Text style={s.navTitle}>{title}</Text>
    </View>
  );
}

export function TabBar({ tabs, onPress }: { tabs: Item[]; onPress?: (id: string) => void }) {
  return (
    <View style={s.tabBar}>
      {tabs.map((t) => (
        <Pressable key={t.id} style={s.tabItem} onPress={() => onPress?.(t.id)}>
          <Text style={s.tabLabel}>{t.title}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Drawer({ items, onPress }: { items: Item[]; onPress?: (id: string) => void }) {
  return (
    <View style={s.panel}>
      {items.map((i) => (
        <Pressable key={i.id} style={s.row} onPress={() => onPress?.(i.id)}>
          <Text style={s.rowTitle}>{i.title}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/* ── Collections ────────────────────────────────────────────── */

function ItemRow({ item, onPress }: { item: Item; onPress?: Handler }) {
  return (
    <Pressable style={s.row} onPress={onPress}>
      {item.image && <RNImage source={{ uri: item.image }} style={s.rowImage} />}
      <View style={s.rowBody}>
        <Text style={s.rowTitle}>{item.title}</Text>
        {item.subtitle && <Text style={s.rowSubtitle}>{item.subtitle}</Text>}
      </View>
      {item.amount && <Text style={s.rowAmount}>{item.amount}</Text>}
    </Pressable>
  );
}

export function List({ items, onItemPress }: { items: Item[]; onItemPress?: (item: Item) => void }) {
  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => <ItemRow item={item} onPress={() => onItemPress?.(item)} />}
      style={s.panel}
      scrollEnabled={false}
    />
  );
}

export function Grid({ items, columns = 2, onItemPress }: { items: Item[]; columns?: number; onItemPress?: (item: Item) => void }) {
  return (
    <View style={s.grid}>
      {items.map((item) => (
        <Pressable key={item.id} style={[s.gridCell, { flexBasis: `${100 / columns - 2}%` }]} onPress={() => onItemPress?.(item)}>
          {item.image && <RNImage source={{ uri: item.image }} style={s.gridImage} />}
          <Text style={s.rowTitle}>{item.title}</Text>
          {item.amount && <Text style={s.rowAmount}>{item.amount}</Text>}
        </Pressable>
      ))}
    </View>
  );
}

export function Carousel({ items }: { items: Item[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
      {items.map((item) => (
        <View key={item.id} style={s.carouselCard}>
          {item.image && <RNImage source={{ uri: item.image }} style={s.carouselImage} />}
          <Text style={s.rowTitle}>{item.title}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

export function InfiniteFeed({ items, pageSize = 20 }: { items: Item[]; pageSize?: number }) {
  const [count, setCount] = useState(pageSize);
  return (
    <View style={s.panel}>
      {items.slice(0, count).map((item) => (
        <ItemRow key={item.id} item={item} />
      ))}
      {count < items.length && <ButtonSecondary label="Load more" onPress={() => setCount(count + pageSize)} />}
    </View>
  );
}

/* ── Content ────────────────────────────────────────────────── */

export function Card({ onPress, children }: { onPress?: Handler; children?: React.ReactNode }) {
  return (
    <Pressable style={s.card} onPress={onPress}>
      {children}
    </Pressable>
  );
}

export function DetailHeader({ title, imageUrl, subtitle }: { title: string; imageUrl?: string; subtitle?: string }) {
  return (
    <View>
      {imageUrl && <RNImage source={{ uri: imageUrl }} style={s.hero} />}
      <Text style={s.h1}>{title}</Text>
      {subtitle && <Text style={s.rowSubtitle}>{subtitle}</Text>}
    </View>
  );
}

export function TextBlock({ text }: { text: string }) {
  return <Text style={s.body}>{text}</Text>;
}

export function ImageBlock({ source, aspectRatio = 16 / 9 }: { source: string; aspectRatio?: number }) {
  return <RNImage source={{ uri: source }} style={[s.image, { aspectRatio }]} />;
}

export function MediaPlayer({ source }: { source: string }) {
  return (
    <View style={[s.placeholder, { aspectRatio: 16 / 9 }]}>
      <Text style={s.placeholderText}>▶ media: {source}</Text>
    </View>
  );
}

export function MapView({ markers = [] }: { markers?: Item[] }) {
  return (
    <View style={[s.placeholder, { aspectRatio: 4 / 3 }]}>
      <Text style={s.placeholderText}>🗺 map · {markers.length} markers</Text>
    </View>
  );
}

export function WebView({ url }: { url: string }) {
  return (
    <View style={[s.placeholder, { padding: spacing.lg }]}>
      <Text style={s.placeholderText}>{url}</Text>
      <ButtonSecondary label="Open in browser" onPress={() => void Linking.openURL(url)} />
    </View>
  );
}

export function Chart({ series = [], kind = 'line' }: { series?: number[]; kind?: 'line' | 'bar' | 'pie' }) {
  const max = Math.max(1, ...series);
  return (
    <View style={s.chart}>
      {series.map((v, i) => (
        <View key={i} style={[s.chartBar, { height: `${(v / max) * 100}%` }]} />
      ))}
      {series.length === 0 && <Text style={s.placeholderText}>chart ({kind})</Text>}
    </View>
  );
}

/* ── Forms & input ──────────────────────────────────────────── */

export interface FieldSpec {
  name: string;
  label: string;
  keyboard?: string;
  required?: boolean;
}

export function FormGroup({ fields, onSubmit }: { fields: FieldSpec[]; onSubmit?: Handler }) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <View style={{ gap: spacing.sm }}>
      {fields.map((f) => (
        <TextInput
          key={f.name}
          label={f.label + (f.required ? ' *' : '')}
          keyboard={f.keyboard}
          value={values[f.name] ?? ''}
          onChange={(v) => setValues({ ...values, [f.name]: v })}
        />
      ))}
      {onSubmit && <ButtonPrimary label="Submit" onPress={onSubmit} />}
    </View>
  );
}

export function TextInput({
  label,
  keyboard = 'text',
  value,
  onChange,
}: {
  label?: string;
  keyboard?: string;
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <View>
      {label && <Text style={s.inputLabel}>{label}</Text>}
      <RNTextInput
        style={s.input}
        value={value}
        onChangeText={onChange}
        secureTextEntry={keyboard === 'password'}
        keyboardType={keyboard === 'number' ? 'numeric' : keyboard === 'email' ? 'email-address' : keyboard === 'phone' ? 'phone-pad' : 'default'}
        placeholderTextColor={colors.muted}
      />
    </View>
  );
}

export function SearchBar({ placeholder = 'Search', onSearch }: { placeholder?: string; onSearch?: (q: string) => void }) {
  const [q, setQ] = useState('');
  return (
    <RNTextInput
      style={s.input}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      value={q}
      onChangeText={setQ}
      onSubmitEditing={() => onSearch?.(q)}
      returnKeyType="search"
    />
  );
}

export function Picker({ options, value, onChange }: { options: Item[]; value?: string; onChange?: (id: string) => void }) {
  return (
    <View style={s.pickerRow}>
      {options.map((o) => (
        <Pressable key={o.id} style={[s.chip, value === o.id && s.chipActive]} onPress={() => onChange?.(o.id)}>
          <Text style={s.rowTitle}>{o.title}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ButtonPrimary({ label, onPress }: { label: string; onPress?: Handler }) {
  return (
    <Pressable style={s.btnPrimary} onPress={onPress} accessibilityRole="button">
      <Text style={s.btnPrimaryText}>{label}</Text>
    </Pressable>
  );
}

export function ButtonSecondary({ label, onPress }: { label: string; onPress?: Handler }) {
  return (
    <Pressable style={s.btnSecondary} onPress={onPress} accessibilityRole="button">
      <Text style={s.btnSecondaryText}>{label}</Text>
    </Pressable>
  );
}

/* ── Commerce ───────────────────────────────────────────────── */

export function CartItemList({
  items,
  onQuantityChange,
  onRemove,
}: {
  items: Item[];
  onQuantityChange?: (item: Item, qty: number) => void;
  onRemove?: (item: Item) => void;
}) {
  return (
    <View style={s.panel}>
      {items.map((item) => (
        <View key={item.id} style={s.row}>
          {item.image && <RNImage source={{ uri: item.image }} style={s.rowImage} />}
          <View style={s.rowBody}>
            <Text style={s.rowTitle}>{item.title}</Text>
            {item.amount && <Text style={s.rowAmount}>{item.amount}</Text>}
          </View>
          <QuantityStepper value={1} onChange={(qty) => onQuantityChange?.(item, qty)} />
          <Pressable onPress={() => onRemove?.(item)} hitSlop={8}>
            <Text style={s.remove}>✕</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

export function PriceRow({ label, amount, emphasis = false }: { label: string; amount: string; emphasis?: boolean }) {
  return (
    <View style={s.priceRow}>
      <Text style={[s.body, emphasis && s.bold]}>{label}</Text>
      <Text style={[s.rowAmount, emphasis && s.bold]}>{amount}</Text>
    </View>
  );
}

export function CheckoutSummary({ items, onPay }: { items: Item[]; onPay?: Handler }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <List items={items} />
      <PriceRow label="Total" amount={items[0]?.amount ?? '—'} emphasis />
      <ButtonPrimary label="Pay now" onPress={onPay ?? (() => Alert.alert('Payment', 'Wire a payment provider here.'))} />
    </View>
  );
}

export function QuantityStepper({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  const [v, setV] = useState(value);
  const set = (next: number) => {
    const clamped = Math.max(0, next);
    setV(clamped);
    onChange?.(clamped);
  };
  return (
    <View style={s.stepper}>
      <Pressable onPress={() => set(v - 1)} hitSlop={6}>
        <Text style={s.stepperBtn}>−</Text>
      </Pressable>
      <Text style={s.body}>{v}</Text>
      <Pressable onPress={() => set(v + 1)} hitSlop={6}>
        <Text style={s.stepperBtn}>＋</Text>
      </Pressable>
    </View>
  );
}

/* ── Identity & settings ────────────────────────────────────── */

export function AvatarHeader({ name, avatarUrl }: { name?: string; avatarUrl?: string }) {
  return (
    <View style={s.avatarHeader}>
      <RNImage source={{ uri: avatarUrl ?? 'https://picsum.photos/seed/oas/96' }} style={s.avatar} />
      <Text style={s.h1}>{name ?? 'Guest'}</Text>
    </View>
  );
}

export function SettingsList({ items }: { items: Item[] }) {
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  return (
    <View style={s.panel}>
      {items.map((item) => (
        <View key={item.id} style={s.row}>
          <View style={s.rowBody}>
            <Text style={s.rowTitle}>{item.title}</Text>
            {item.subtitle && <Text style={s.rowSubtitle}>{item.subtitle}</Text>}
          </View>
          {typeof item.value === 'boolean' && (
            <Switch
              value={toggles[item.id] ?? item.value}
              onValueChange={(v) => setToggles({ ...toggles, [item.id]: v })}
            />
          )}
        </View>
      ))}
    </View>
  );
}

/* ── Feedback ───────────────────────────────────────────────── */

export function Dialog({
  title,
  message,
  visible = true,
  onConfirm,
  onCancel,
}: {
  title: string;
  message?: string;
  visible?: boolean;
  onConfirm?: Handler;
  onCancel?: Handler;
}) {
  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={s.dialogBackdrop}>
        <View style={s.dialog}>
          <Text style={s.h1}>{title}</Text>
          {message && <Text style={s.body}>{message}</Text>}
          <View style={s.dialogActions}>
            {onCancel && <ButtonSecondary label="Cancel" onPress={onCancel} />}
            <ButtonPrimary label="OK" onPress={onConfirm ?? (() => {})} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function Toast({ message, kind = 'info' }: { message: string; kind?: 'info' | 'success' | 'error' }) {
  const tint = kind === 'success' ? colors.success : kind === 'error' ? colors.danger : colors.accent;
  return (
    <View style={[s.toast, { borderColor: tint }]}>
      <Text style={s.body}>{message}</Text>
    </View>
  );
}

export function EmptyState({ message, actionLabel, onPress }: { message: string; actionLabel?: string; onPress?: Handler }) {
  return (
    <View style={s.empty}>
      <Text style={s.placeholderText}>{message}</Text>
      {actionLabel && <ButtonSecondary label={actionLabel} onPress={onPress} />}
    </View>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <View style={{ gap: spacing.sm }}>
      {Array.from({ length: lines }, (_, i) => (
        <View key={i} style={s.skeletonLine} />
      ))}
    </View>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const s = StyleSheet.create({
  navHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  navBack: { fontSize: 28, color: colors.accent },
  navTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderColor: colors.border },
  tabItem: { flex: 1, alignItems: 'center', padding: spacing.sm },
  tabLabel: { color: colors.text, fontSize: 12 },
  panel: { backgroundColor: colors.panel, borderRadius: radii.md, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rowBody: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '500' },
  rowSubtitle: { color: colors.muted, fontSize: 13, marginTop: 2 },
  rowAmount: { color: colors.text, fontSize: 15, fontVariant: ['tabular-nums'] },
  rowImage: { width: 44, height: 44, borderRadius: radii.sm, backgroundColor: colors.border },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gridCell: { flexGrow: 1, backgroundColor: colors.panel, borderRadius: radii.md, padding: spacing.md, gap: 6 },
  gridImage: { width: '100%', aspectRatio: 1, borderRadius: radii.sm, backgroundColor: colors.border },
  carouselCard: { width: 220, backgroundColor: colors.panel, borderRadius: radii.md, padding: spacing.md, gap: 6 },
  carouselImage: { width: '100%', aspectRatio: 16 / 9, borderRadius: radii.sm, backgroundColor: colors.border },
  card: { backgroundColor: colors.panel, borderRadius: radii.md, padding: spacing.md, gap: spacing.sm },
  hero: { width: '100%', aspectRatio: 16 / 9, borderRadius: radii.md, backgroundColor: colors.border },
  h1: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: spacing.sm },
  body: { fontSize: 15, color: colors.text, lineHeight: 22 },
  bold: { fontWeight: '700' },
  image: { width: '100%', borderRadius: radii.md, backgroundColor: colors.border },
  placeholder: {
    backgroundColor: colors.panel,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  placeholderText: { color: colors.muted, fontSize: 13 },
  chart: { height: 140, flexDirection: 'row', alignItems: 'flex-end', gap: 4, backgroundColor: colors.panel, borderRadius: radii.md, padding: spacing.sm },
  chartBar: { flex: 1, backgroundColor: colors.accent, borderRadius: 2 },
  inputLabel: { color: colors.muted, fontSize: 13, marginBottom: 4 },
  input: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    color: colors.text,
  },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chipActive: { borderColor: colors.accent, backgroundColor: colors.panel },
  btnPrimary: { backgroundColor: colors.accent, borderRadius: radii.md, padding: spacing.md, alignItems: 'center' },
  btnPrimaryText: { color: colors.onAccent, fontSize: 16, fontWeight: '600' },
  btnSecondary: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, alignItems: 'center' },
  btnSecondaryText: { color: colors.text, fontSize: 15 },
  remove: { color: colors.muted, fontSize: 16, padding: spacing.xs },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepperBtn: { color: colors.accent, fontSize: 20, paddingHorizontal: 4 },
  avatarHeader: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  avatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.border },
  dialogBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  dialog: { backgroundColor: colors.panel, borderRadius: radii.lg, padding: spacing.lg, width: '100%', gap: spacing.sm },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  toast: { borderWidth: 1, borderRadius: radii.md, padding: spacing.md, backgroundColor: colors.panel },
  empty: { alignItems: 'center', gap: spacing.md, padding: spacing.xl },
  skeletonLine: { height: 14, borderRadius: radii.sm, backgroundColor: colors.border, opacity: 0.6 },
});
