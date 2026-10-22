CEF Christmas CPC Staff Portal — reviewed mobile build

Files:
- index.html
- app.js
- styles.css

Changes are limited to:
- Responsive/mobile layout improvements for phones and tablets.
- Larger touch targets, safer horizontal table scrolling, narrow-screen spacing,
  focus visibility, and mobile menu accessibility state.
- Fixed receipt input validation mismatch: a receipt is required for a positive
  expense, matching the existing submission validation and on-screen explanation.
- Better validation message when the Supabase key is blank.

Important:
- This browser client relies on Supabase SQL/RLS policies for authorization.
- Use only the Supabase publishable/anon key in the browser; never use a service-role key.
- The three files should remain together with the existing assets/cef-logo.jpg.
- Test with a staff account and an admin account before deploying to all 100 staff.
- This review cannot verify database schema, RLS policies, storage policies, or live data
  without access to the configured Supabase project.
