/**
 * HUD Driver - Utility for reading and asserting HUD values in E2E tests
 *
 * Usage:
 *   const hud = new HudDriver(page);
 *   await hud.waitForVisible();
 *   const values = await hud.getValues();
 *   console.log(values); // { spineAngle: 45, armAngle: 30, speed: 2.5, position: 'Top' }
 */

import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export interface HudValues {
  spineAngle: number | null;
  armAngle: number | null;
  speed: number | null;
  position: string | null;
}

export class HudDriver {
  private page: Page;
  private overlay: Locator;

  constructor(page: Page) {
    this.page = page;
    this.overlay = page.locator('.hud-overlay');
  }

  /**
   * Wait for the HUD overlay to be visible
   */
  async waitForVisible(timeout = 5000): Promise<void> {
    await expect(this.overlay).toBeVisible({ timeout });
  }

  /**
   * Wait for the HUD overlay to be hidden
   */
  async waitForHidden(timeout = 5000): Promise<void> {
    await expect(this.overlay).not.toBeVisible({ timeout });
  }

  /**
   * Check if HUD is currently visible
   */
  async isVisible(): Promise<boolean> {
    return this.overlay.isVisible();
  }

  /**
   * Get all HUD values at once
   */
  async getValues(): Promise<HudValues> {
    return this.page.evaluate(() => {
      const parseNumber = (text: string | null | undefined): number | null => {
        if (!text) return null;
        const match = text.match(/(-?\d+\.?\d*)/);
        return match ? parseFloat(match[1]) : null;
      };

      const spineEl = document.querySelector('#hud-spineAngle');
      const armEl = document.querySelector('#hud-armAngle');
      const speedEl = document.querySelector('#hud-speed');
      const positionEl = document.querySelector(
        '.hud-overlay-position .hud-overlay-angle-value'
      );

      return {
        spineAngle: parseNumber(spineEl?.textContent),
        armAngle: parseNumber(armEl?.textContent),
        speed: parseNumber(speedEl?.textContent),
        position: positionEl?.textContent?.trim() || null,
      };
    });
  }

  /**
   * Get spine angle value
   */
  async getSpineAngle(): Promise<number | null> {
    const text = await this.page.locator('#hud-spineAngle').textContent();
    const match = text?.match(/(-?\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Get arm angle value
   */
  async getArmAngle(): Promise<number | null> {
    const text = await this.page.locator('#hud-armAngle').textContent();
    const match = text?.match(/(-?\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Get wrist speed value in m/s
   */
  async getSpeed(): Promise<number | null> {
    const text = await this.page.locator('#hud-speed').textContent();
    const match = text?.match(/(-?\d+\.?\d*)/);
    return match ? parseFloat(match[1]) : null;
  }

  /**
   * Get current position label (Top, Bottom, Connect, Release)
   */
  async getPosition(): Promise<string | null> {
    const positionEl = this.page.locator(
      '.hud-overlay-position .hud-overlay-angle-value'
    );
    if (!(await positionEl.isVisible())) return null;
    return positionEl.textContent();
  }

  /**
   * Assert spine angle is within range
   */
  async expectSpineAngleInRange(min: number, max: number): Promise<void> {
    const angle = await this.getSpineAngle();
    expect(angle).not.toBeNull();
    expect(angle).toBeGreaterThanOrEqual(min);
    expect(angle).toBeLessThanOrEqual(max);
  }

  /**
   * Assert speed is within range
   */
  async expectSpeedInRange(min: number, max: number): Promise<void> {
    const speed = await this.getSpeed();
    expect(speed).not.toBeNull();
    expect(speed).toBeGreaterThanOrEqual(min);
    expect(speed).toBeLessThanOrEqual(max);
  }

  /**
   * Assert position matches expected
   */
  async expectPosition(expected: string): Promise<void> {
    const position = await this.getPosition();
    expect(position).toBe(expected);
  }

  /**
   * Log current HUD values to console (useful for debugging)
   */
  async logValues(): Promise<HudValues> {
    const values = await this.getValues();
    console.log('[HUD]', JSON.stringify(values, null, 2));
    return values;
  }

  /**
   * Collect HUD values over time (for analyzing speed/angle curves)
   * @param durationMs - How long to collect
   * @param intervalMs - Sampling interval
   */
  async collectOverTime(
    durationMs: number,
    intervalMs = 100
  ): Promise<Array<HudValues & { timestamp: number }>> {
    const samples: Array<HudValues & { timestamp: number }> = [];
    const startTime = Date.now();
    const endTime = startTime + durationMs;

    while (Date.now() < endTime) {
      const values = await this.getValues();
      samples.push({ ...values, timestamp: Date.now() - startTime });
      await this.page.waitForTimeout(intervalMs);
    }

    return samples;
  }
}
