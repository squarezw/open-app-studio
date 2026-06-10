import { describe, expect, it } from 'vitest';
import { parseUiautomatorXml } from '../src/parse-uiautomator.js';

const SAMPLE = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example.shop"
        content-desc="" checkable="false" checked="false" clickable="false" enabled="true"
        focusable="false" focused="false" scrollable="false" long-clickable="false" password="false"
        selected="false" bounds="[0,0][1080,2400]">
    <node index="0" text="Shop" resource-id="com.example.shop:id/title" class="android.widget.TextView"
          package="com.example.shop" content-desc="" checkable="false" checked="false" clickable="false"
          enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false"
          password="false" selected="false" bounds="[40,80][400,160]" />
    <node index="1" text="" resource-id="com.example.shop:id/list" class="androidx.recyclerview.widget.RecyclerView"
          package="com.example.shop" content-desc="" checkable="false" checked="false" clickable="false"
          enabled="true" focusable="true" focused="false" scrollable="true" long-clickable="false"
          password="false" selected="false" bounds="[0,200][1080,2200]">
      <node index="0" text="Apple" resource-id="" class="android.widget.TextView" package="com.example.shop"
            content-desc="fruit apple" checkable="false" checked="false" clickable="true" enabled="true"
            focusable="true" focused="false" scrollable="false" long-clickable="false" password="false"
            selected="false" bounds="[0,200][1080,360]" />
      <node index="1" text="Banana" resource-id="" class="android.widget.TextView" package="com.example.shop"
            content-desc="fruit banana" checkable="false" checked="false" clickable="true" enabled="true"
            focusable="true" focused="false" scrollable="false" long-clickable="false" password="false"
            selected="false" bounds="[0,360][1080,520]" />
    </node>
    <node index="2" text="Checkout" resource-id="com.example.shop:id/btn_checkout" class="android.widget.Button"
          package="com.example.shop" content-desc="" checkable="false" checked="false" clickable="true"
          enabled="false" focusable="true" focused="false" scrollable="false" long-clickable="false"
          password="false" selected="false" bounds="[40,2240][1040,2380]" />
  </node>
</hierarchy>`;

describe('parseUiautomatorXml', () => {
  it('parses the hierarchy into a normalized UiNode tree', () => {
    const root = parseUiautomatorXml(SAMPLE);
    expect(root.className).toBe('android.widget.FrameLayout');
    expect(root.children).toHaveLength(3);

    const [title, list, checkout] = root.children;
    expect(title!.text).toBe('Shop');
    expect(title!.resourceId).toBe('com.example.shop:id/title');
    expect(title!.clickable).toBe(false);

    expect(list!.scrollable).toBe(true);
    expect(list!.children).toHaveLength(2);
    expect(list!.children[0]!.contentDesc).toBe('fruit apple');
    expect(list!.children[0]!.clickable).toBe(true);

    expect(checkout!.clickable).toBe(true);
    expect(checkout!.enabled).toBe(false);
  });

  it('parses bounds into x/y/w/h rects', () => {
    const root = parseUiautomatorXml(SAMPLE);
    expect(root.bounds).toEqual({ x: 0, y: 0, w: 1080, h: 2400 });
    const checkout = root.children[2]!;
    expect(checkout.bounds).toEqual({ x: 40, y: 2240, w: 1000, h: 140 });
  });

  it('throws on a dump with no nodes', () => {
    expect(() => parseUiautomatorXml('<hierarchy rotation="0"></hierarchy>')).toThrow(/no <node>/);
  });
});
