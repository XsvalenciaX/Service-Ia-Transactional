-- El bot no habla de dinero en ningun momento, asi que el monto de la factura
-- dejo de extraerse y de guardarse. Esto saca las claves de las filas que ya
-- estaban en la base: sin esto seguirian viajando al modelo del plan.
UPDATE "receipts"
SET "extractedData" = "extractedData" - 'amount' - 'currency'
WHERE "extractedData" ? 'amount' OR "extractedData" ? 'currency';
