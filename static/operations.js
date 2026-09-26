document.addEventListener("DOMContentLoaded", function () {

    const receiptForm = document.getElementById("receiptForm");

    if (receiptForm) {
        receiptForm.addEventListener("submit", function (event) {
            event.preventDefault();

            const supplier = document.getElementById("supplier").value;
            const product = document.getElementById("product").value;
            const quantity = document.getElementById("quantity").value;
            const warehouse = document.getElementById("warehouse").value;

            if (quantity <= 0) {
                alert("Quantity must be greater than 0.");
                return;
            }

            console.log("Receipt:", {
                supplier,
                product,
                quantity,
                warehouse
            });

            document.getElementById("successMessage").style.display = "block";

            receiptForm.reset();
        });
    }


    const deliveryForm = document.getElementById("deliveryForm");

    if (deliveryForm) {
        deliveryForm.addEventListener("submit", function (event) {
            event.preventDefault();

            const customer = document.getElementById("customer").value;
            const product = document.getElementById("product").value;
            const quantity = document.getElementById("quantity").value;
            const warehouse = document.getElementById("warehouse").value;

            if (quantity <= 0) {
                alert("Quantity must be greater than 0.");
                return;
            }

            console.log("Delivery:", {
                customer,
                product,
                quantity,
                warehouse
            });

            showMessage(
                "Delivery order created successfully.",
                true
            );

            deliveryForm.reset();
        });
    }


    const transferForm = document.getElementById("transferForm");

    if (transferForm) {
        transferForm.addEventListener("submit", function (event) {
            event.preventDefault();

            const product = document.getElementById("product").value;
            const quantity = document.getElementById("quantity").value;
            const source = document.getElementById("source").value;
            const destination = document.getElementById("destination").value;

            if (quantity <= 0) {
                alert("Quantity must be greater than 0.");
                return;
            }

            if (source === destination) {
                alert("Source and destination cannot be the same.");
                return;
            }

            console.log("Transfer:", {
                product,
                quantity,
                source,
                destination
            });

            showMessage(
                "Internal transfer created successfully.",
                true
            );

            transferForm.reset();
        });
    }


    function showMessage(message, success) {
        const element = document.getElementById("message");

        if (!element) return;

        element.textContent = message;
        element.style.display = "block";

        if (success) {
            element.style.background = "#dcfce7";
            element.style.color = "#166534";
        } else {
            element.style.background = "#fee2e2";
            element.style.color = "#991b1b";
        }
    }

});