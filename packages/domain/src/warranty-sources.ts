/**
 * Manufacturer warranty sources (v2.15).
 *
 * The manufacturers do not share one open warranty API - Dell resolves a
 * service tag straight from a URL, Lenovo/HP/Acer and the rest run official
 * lookup pages (their full APIs are partner-credentialed). So the honest
 * automation is: detect the maker from what the asset already knows, and take
 * the technician to the RIGHT official source with the serial in hand.
 * `serialInUrl` says whether the vendor resolves the device from the link
 * itself; when false, the UI copies the serial for pasting.
 */

export interface WarrantySource {
  /** Canonical vendor key. */
  vendor: string;
  label: string;
  /** The official lookup destination for this device. */
  url: string;
  /** True when the URL itself resolves the device (no typing on arrival). */
  serialInUrl: boolean;
}

interface VendorDef {
  vendor: string;
  label: string;
  /** Lower-cased substrings that identify the maker in brand/model strings. */
  matches: string[];
  /** The lookup form - always valid, serial typed by hand. */
  lookupUrl: string;
  /** URL that resolves the device directly, where the vendor supports it. */
  directUrl?: (serial: string) => string;
}

const VENDORS: VendorDef[] = [
  {
    vendor: 'dell',
    label: 'Dell',
    matches: ['dell'],
    lookupUrl: 'https://www.dell.com/support/home/en-us',
    directUrl: (serial) =>
      `https://www.dell.com/support/home/en-us/product-support/servicetag/${encodeURIComponent(serial)}/overview`,
  },
  {
    vendor: 'lenovo',
    label: 'Lenovo',
    matches: ['lenovo', 'thinkpad', 'ideapad', 'thinkcentre'],
    lookupUrl: 'https://pcsupport.lenovo.com/warranty-lookup',
    directUrl: (serial) => `https://pcsupport.lenovo.com/products/${encodeURIComponent(serial)}`,
  },
  {
    vendor: 'hp',
    label: 'HP',
    matches: ['hp', 'hewlett', 'victus', 'elitebook', 'pavilion', 'zbook', 'probook'],
    lookupUrl: 'https://support.hp.com/us-en/check-warranty',
  },
  {
    vendor: 'acer',
    label: 'Acer',
    matches: ['acer', 'predator', 'aspire', 'nitro'],
    lookupUrl: 'https://www.acer.com/us-en/support',
  },
  {
    vendor: 'asus',
    label: 'ASUS',
    matches: ['asus', 'zenbook', 'vivobook', 'rog '],
    lookupUrl: 'https://www.asus.com/support/warranty-status-inquiry/',
  },
  {
    vendor: 'apple',
    label: 'Apple',
    matches: ['apple', 'macbook', 'imac', 'mac mini', 'mac pro'],
    lookupUrl: 'https://checkcoverage.apple.com/',
  },
  {
    vendor: 'microsoft',
    label: 'Microsoft',
    matches: ['microsoft', 'surface'],
    lookupUrl: 'https://account.microsoft.com/devices',
  },
  {
    vendor: 'samsung',
    label: 'Samsung',
    matches: ['samsung', 'galaxy book'],
    lookupUrl: 'https://www.samsung.com/us/support/warranty/',
  },
  {
    vendor: 'msi',
    label: 'MSI',
    matches: ['msi', 'micro-star'],
    lookupUrl: 'https://www.msi.com/support/warranty',
  },
];

/**
 * Detects the manufacturer from whatever identity strings the asset carries.
 * The agent-reported hardware manufacturer is the strongest signal, so callers
 * should pass it first; brand and model are the fallback for sheet-imported
 * devices. Word-ish matching, so "HP" does not fire inside "ThinkPad".
 */
export function detectWarrantyVendor(
  ...identityStrings: (string | null | undefined)[]
): VendorDef | null {
  const haystack = ` ${identityStrings.filter(Boolean).join(' ').toLowerCase()} `;
  for (const vendor of VENDORS) {
    for (const needle of vendor.matches) {
      // Word-boundary match on both sides, so "hp" cannot fire inside
      // "Sharp" and "dell" cannot fire inside a longer word. Needles that
      // end in a space ("rog ") carry their own right boundary.
      let from = 0;
      for (;;) {
        const at = haystack.indexOf(needle, from);
        if (at === -1) break;
        from = at + 1;
        const before = haystack[at - 1] ?? ' ';
        const after = haystack[at + needle.length] ?? ' ';
        if (/[a-z0-9]/.test(before)) continue;
        if (!needle.endsWith(' ') && /[a-z0-9]/.test(after)) continue;
        return vendor;
      }
    }
  }
  return null;
}

/** The official warranty source for a device, or null when unknown. */
export function warrantySource(
  serial: string | null | undefined,
  ...identityStrings: (string | null | undefined)[]
): WarrantySource | null {
  const vendor = detectWarrantyVendor(...identityStrings);
  if (!vendor) return null;
  const direct = serial && vendor.directUrl ? vendor.directUrl(serial) : null;
  return {
    vendor: vendor.vendor,
    label: vendor.label,
    // Without a serial (or a vendor that resolves one) the lookup form still
    // helps - never a half-built device URL.
    url: direct ?? vendor.lookupUrl,
    serialInUrl: Boolean(direct),
  };
}
