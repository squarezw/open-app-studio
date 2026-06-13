import { describe, expect, it } from 'vitest';
import { parseAppiumSource } from '../src/parse-uiautomator.js';

// Appium UiAutomator2 getPageSource: the element tag IS the class name, with a
// `class` attribute too; bounds/resource-id/text/focusable are attributes.
const SAMPLE = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy index="0" class="hierarchy" rotation="0" width="1080" height="2400">
  <android.widget.FrameLayout index="0" package="com.iherb" class="android.widget.FrameLayout" clickable="false" enabled="true" focusable="false" bounds="[0,0][1080,2400]">
    <android.widget.EditText index="0" class="android.widget.EditText" resource-id="com.iherb:id/input_edit_text" text="Full Name *" clickable="true" enabled="true" focusable="true" bounds="[40,200][1040,320]" />
    <android.widget.EditText index="1" class="android.widget.EditText" resource-id="com.iherb:id/input_edit_text" text="United States" clickable="true" enabled="true" focusable="false" bounds="[40,360][1040,480]" />
    <androidx.recyclerview.widget.RecyclerView index="2" class="androidx.recyclerview.widget.RecyclerView" scrollable="true" enabled="true" bounds="[0,520][1080,2400]" />
  </android.widget.FrameLayout>
</hierarchy>`;

describe('parseAppiumSource', () => {
  it('reads the class attribute as className and walks tag-named elements', () => {
    const root = parseAppiumSource(SAMPLE);
    expect(root.className).toBe('android.widget.FrameLayout');
    expect(root.children).toHaveLength(3);
    const [name, country, list] = root.children;
    expect(name!.className).toBe('android.widget.EditText');
    expect(name!.resourceId).toBe('com.iherb:id/input_edit_text');
    expect(name!.text).toBe('Full Name *');
    expect(name!.bounds).toEqual({ x: 40, y: 200, w: 1000, h: 120 });
    expect(list!.scrollable).toBe(true);
  });

  it('preserves focusable so dropdowns (focusable=false) are distinguishable', () => {
    const [name, country] = parseAppiumSource(SAMPLE).children;
    expect(name!.focusable).toBe(true); // real text field
    expect(country!.focusable).toBe(false); // dropdown rendered as EditText
  });

  it('throws on a sourceless document', () => {
    expect(() => parseAppiumSource('<note/>')).toThrow(/no <hierarchy>/);
  });
});
