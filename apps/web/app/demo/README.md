# Checkout demo target

Open `/demo?bug=1` for the known-fail target and `/demo?bug=0` for the known-pass target. The page defaults to known-fail and starts with an empty coupon and a total of `100000`.

| Element      | Test ID        | Accessible name or value                                                       |
| ------------ | -------------- | ------------------------------------------------------------------------------ |
| Coupon input | `coupon-input` | Coupon code                                                                    |
| Apply button | `apply-coupon` | Apply coupon                                                                   |
| Total        | `order-total`  | Exact text `100000` after `SAVE10` in buggy mode and `90000` in corrected mode |

The fixture workflow from `@veriflow/core/fixtures` navigates to the known-fail URL, fills the coupon, clicks Apply coupon, and asserts exact text `90000`. The links in the workbench preview both target URLs directly. They leave saved workflow revisions untouched. Coordinate the target switch with Dev 1 before the integrated browser rerun.

The workbench and demo use shadcn/ui Radix Nova Card and Input, with Veriflow theme tokens and layout overrides. See the workbench README for the local setup. [shadcn/ui setup](https://ui.shadcn.com/docs/installation/manual)
